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
const mcp = readJson(".mcp.json");
const serverSource = readFileSync(resolve(root, "src/server/index.ts"), "utf8");

if (packageJson.name !== codexPlugin.name || packageJson.name !== claudePlugin.name) {
  fail("package and plugin names differ");
}
if (packageJson.version !== codexPlugin.version || packageJson.version !== claudePlugin.version) {
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
  "skills/mailbridge/SKILL.md",
  "assets/icon.svg",
  "assets/logo.svg",
  "assets/logo-dark.svg",
]) {
  if (!existsSync(resolve(root, path))) fail(`required payload is missing: ${path}`);
}

const registration = mcp.mcpServers?.mailbridge;
if (registration?.command !== "node" || registration?.args?.[0] !== "./dist/cli.js") {
  fail(".mcp.json does not launch the committed bundle");
}
if (registration?.env?.MAILBRIDGE_MODE !== "prompted") {
  fail("plugin MCP registration is not configured for per-send prompting");
}

const claudeRegistration = claudePlugin.mcpServers?.mailbridge;
if (
  claudeRegistration?.command !== "node" ||
  claudeRegistration?.args?.[0] !== "${CLAUDE_PLUGIN_ROOT}/dist/cli.js"
) {
  fail("Claude plugin MCP registration does not launch the committed bundle");
}
if (claudeRegistration?.env?.MAILBRIDGE_MODE !== "read-only") {
  fail("Claude plugin MCP registration is not read-only by default");
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
