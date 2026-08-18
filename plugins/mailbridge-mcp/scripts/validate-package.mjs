import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const root = process.cwd();
const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const fail = (message) => {
  throw new Error(`Package validation failed: ${message}`);
};

const packageJson = readJson("package.json");
const codexPlugin = readJson(".codex-plugin/plugin.json");
const claudePlugin = readJson(".claude-plugin/plugin.json");
const grokPlugin = readJson(".grok-plugin/plugin.json");
const serverSource = readFileSync(resolve(root, "src/server/index.ts"), "utf8");

if (packageJson.name !== codexPlugin.name || packageJson.name !== claudePlugin.name || packageJson.name !== grokPlugin.name) {
  fail("package and plugin names differ");
}
if (
  packageJson.version !== codexPlugin.version ||
  packageJson.version !== claudePlugin.version ||
  packageJson.version !== grokPlugin.version
) {
  fail("package and plugin versions differ");
}
if (!serverSource.includes(`version: "${packageJson.version}"`)) {
  fail("MCP server version differs from package version");
}

for (const path of [
  "dist/cli.js",
  "runtime/mailbridge.jxa.js",
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
  ".grok-plugin/plugin.json",
  "skills/mailbridge/SKILL.md",
  "assets/icon.svg",
  "assets/logo.svg",
  "assets/logo-dark.svg",
]) {
  if (!existsSync(resolve(root, path))) fail(`required payload is missing: ${path}`);
}

const codexRegistration = codexPlugin.mcpServers?.mailbridge;
const claudeRegistration = claudePlugin.mcpServers?.mailbridge;
const grokRegistration = grokPlugin.mcpServers?.mailbridge;
for (const [host, registration, argument, cwd] of [
  ["Codex", codexRegistration, "./dist/cli.js", "."],
  ["Claude", claudeRegistration, "${CLAUDE_PLUGIN_ROOT}/dist/cli.js", undefined],
  ["Grok", grokRegistration, "${GROK_PLUGIN_ROOT}/dist/cli.js", undefined],
]) {
  if (
    registration?.command !== "node" ||
    !Array.isArray(registration.args) ||
    registration.args.length !== 1 ||
    registration.args[0] !== argument ||
    registration.cwd !== cwd
  ) {
    fail(`${host} plugin MCP registration does not launch the committed bundle from the plugin root`);
  }
  if (registration.env?.MAILBRIDGE_MODE !== "prompted") {
    fail(`${host} plugin MCP registration is not configured for per-send prompting`);
  }
}
if (existsSync(resolve(root, ".mcp.json"))) {
  fail("a convention .mcp.json can override the host-specific MCP registrations");
}

const runtime = readFileSync(resolve(root, "runtime/mailbridge.jxa.js"), "utf8");
const bundle = readFileSync(resolve(root, "dist/cli.js"), "utf8");
const sendSurface = `${runtime}\n${bundle}`;
if (!runtime.includes("sendMessageOperation") || !runtime.includes("sendReplyOperation")) {
  fail("reviewed atomic send operations are missing from the dispatcher");
}
if (!bundle.includes("mail_send_message") || !bundle.includes("mail_send_reply")) {
  fail("reviewed send tools are missing from the bundle");
}
if (!serverSource.includes("elicitInput") || !bundle.includes("CONFIRMATION_UNAVAILABLE")) {
  fail("prompted send confirmation is missing from the payload");
}
if (/mail_send_draft|sendDraft|sendForward/.test(sendSurface)) {
  fail("payload contains an unreviewed draft or forward send operation");
}

process.stdout.write(`Validated ${packageJson.name} ${packageJson.version} package metadata.\n`);
