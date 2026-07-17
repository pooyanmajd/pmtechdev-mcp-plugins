import { constants } from "node:fs";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { clearTimeout, setTimeout } from "node:timers";

const protocolVersion = "2025-11-25";
const expectedTools = new Set([
  "mail_list_accounts",
  "mail_search_messages",
  "mail_get_message",
  "mail_send_message",
  "mail_send_reply",
]);
const temporaryRoot = await mkdtemp(join(tmpdir(), "mailbridge-package-smoke-"));
const npmEnvironment = { ...process.env, npm_config_cache: resolve(temporaryRoot, "npm-cache") };

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `:\n${detail}` : ""}`);
  }
  return result.stdout;
}

function requestClient(executable, args, cwd, extraEnvironment = {}) {
  const child = spawn(executable, args, {
    cwd,
    env: {
      HOME: process.env.HOME ?? temporaryRoot,
      MAILBRIDGE_MODE: "read-only",
      PATH: process.env.PATH ?? "",
      TMPDIR: process.env.TMPDIR ?? tmpdir(),
      ...extraEnvironment,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", (error) => {
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  });
  child.on("exit", (code, signal) => {
    if (pending.size === 0) return;
    const error = new Error(`Packaged server exited before responding (code ${String(code)}, signal ${String(signal)})${stderr ? `: ${stderr.trim()}` : ""}`);
    for (const entry of pending.values()) {
      clearTimeout(entry.timeout);
      entry.reject(error);
    }
    pending.clear();
  });
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const entry = pending.get(message.id);
    if (entry === undefined) return;
    pending.delete(message.id);
    clearTimeout(entry.timeout);
    if (message.error !== undefined) entry.reject(new Error(`MCP error ${JSON.stringify(message.error)}`));
    else entry.resolve(message.result);
  });

  function send(message) {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  function request(id, method, params = {}) {
    return new Promise((resolvePromise, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}${stderr ? `: ${stderr.trim()}` : ""}`));
      }, 10_000);
      pending.set(id, { reject, resolve: resolvePromise, timeout });
      send({ jsonrpc: "2.0", id, method, params });
    });
  }

  async function close() {
    lines.close();
    child.stdin.end();
    await Promise.race([
      new Promise((resolvePromise) => child.once("exit", resolvePromise)),
      new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000)),
    ]);
    if (child.exitCode === null) child.kill("SIGTERM");
  }

  return { close, request, send };
}

async function verifyClient(client) {
  const initialized = await client.request(1, "initialize", {
    capabilities: {},
    clientInfo: { name: "mailbridge-package-smoke", version: "1.0.0" },
    protocolVersion,
  });
  if (initialized?.serverInfo?.name !== "mailbridge-mcp") {
    throw new Error("initialize returned the wrong server name");
  }
  client.send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
  const listed = await client.request(2, "tools/list");
  if (!Array.isArray(listed?.tools) || listed.tools.length === 0) {
    throw new Error("tools/list returned no tools");
  }
  const names = new Set(listed.tools.map((tool) => tool?.name));
  for (const tool of expectedTools) {
    if (!names.has(tool)) throw new Error(`tools/list is missing ${tool}`);
  }
  return listed.tools.length;
}

try {
  if (process.platform !== "darwin") throw new Error("Mailbridge package smoke test requires macOS");
  const packageDirectory = resolve(temporaryRoot, "package");
  const installDirectory = resolve(temporaryRoot, "install");
  await mkdir(packageDirectory, { recursive: true });
  const packOutput = run("npm", ["pack", "--workspace", "mailbridge-mcp", "--pack-destination", packageDirectory, "--json"], { env: npmEnvironment });
  const packed = JSON.parse(packOutput);
  const filename = packed?.[0]?.filename;
  if (typeof filename !== "string" || filename.length === 0) throw new Error("npm pack did not report an artifact filename");
  const tarball = resolve(packageDirectory, filename);
  run("npm", [
    "install", "--prefix", installDirectory, "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund", "--offline", tarball,
  ], { env: npmEnvironment });

  const installedPluginRoot = resolve(installDirectory, "node_modules/mailbridge-mcp");
  const executable = resolve(installDirectory, "node_modules/.bin/mailbridge-mcp");
  await access(executable, constants.X_OK);
  const client = requestClient(executable, [], installDirectory);
  let listedToolCount;
  try {
    listedToolCount = await verifyClient(client);
  } finally {
    await client.close();
  }

  const claudeManifest = JSON.parse(
    await readFile(resolve(installedPluginRoot, ".claude-plugin/plugin.json"), "utf8"),
  );
  const claudeRegistration = claudeManifest.mcpServers?.mailbridge;
  if (
    claudeRegistration?.command !== "node" ||
    !Array.isArray(claudeRegistration.args) ||
    claudeRegistration.args.length === 0
  ) {
    throw new Error("Packaged Claude plugin MCP registration is invalid");
  }
  const expandPluginRoot = (value) => value.replaceAll("${CLAUDE_PLUGIN_ROOT}", installedPluginRoot);
  const claudeClient = requestClient(
    expandPluginRoot(claudeRegistration.command),
    claudeRegistration.args.map(expandPluginRoot),
    installedPluginRoot,
    {
      CLAUDE_PLUGIN_ROOT: installedPluginRoot,
      ...Object.fromEntries(
        Object.entries(claudeRegistration.env ?? {}).map(([key, value]) => [key, expandPluginRoot(value)]),
      ),
    },
  );
  try {
    const claudeToolCount = await verifyClient(claudeClient);
    if (claudeToolCount !== listedToolCount) {
      throw new Error("Claude plugin MCP registration listed a different tool count");
    }
  } finally {
    await claudeClient.close();
  }

  process.stdout.write(
    `Packaged Mailbridge initialized through its binary and Claude plugin MCP registration, listing ${listedToolCount} tools without invoking Mail.\n`,
  );
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}
