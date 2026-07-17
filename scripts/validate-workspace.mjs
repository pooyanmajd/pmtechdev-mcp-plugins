import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const root = process.cwd();
const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const fail = (message) => {
  throw new Error(`Workspace validation failed: ${message}`);
};

const rootPackage = readJson("package.json");
const codexMarketplace = readJson(".agents/plugins/marketplace.json");
const claudeMarketplace = readJson(".claude-plugin/marketplace.json");
const pluginRoot = resolve(root, "plugins");
const pluginDirectories = readdirSync(pluginRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

if (rootPackage.name !== "pmtechdev-mcp-plugins") fail("unexpected root package name");
if (!rootPackage.workspaces?.includes("plugins/*") || !rootPackage.workspaces?.includes("packages/*")) {
  fail("root workspaces must include plugins/* and packages/*");
}
if (codexMarketplace.name !== "pmtechdev" || claudeMarketplace.name !== "pmtechdev") {
  fail("marketplace names must be pmtechdev");
}
if (!Array.isArray(codexMarketplace.plugins) || !Array.isArray(claudeMarketplace.plugins)) {
  fail("marketplace plugins must be arrays");
}
for (const path of [
  "packages/mcp-kit/src/index.ts",
  "templates/mcp-plugin/.claude-plugin/plugin.json",
  "templates/mcp-plugin/.codex-plugin/plugin.json",
  "scripts/create-plugin.mjs"
]) {
  if (!existsSync(resolve(root, path))) fail(`required reusable workspace asset is missing: ${path}`);
}

const codexMarketplaceNames = new Set();
for (const entry of codexMarketplace.plugins) {
  if (codexMarketplaceNames.has(entry.name)) fail(`duplicate Codex marketplace plugin: ${entry.name}`);
  codexMarketplaceNames.add(entry.name);
  if (entry.source?.source !== "local" || entry.source?.path !== `./plugins/${entry.name}`) {
    fail(`invalid marketplace source for ${entry.name}`);
  }
  if (entry.policy?.installation !== "AVAILABLE" || entry.policy?.authentication !== "ON_INSTALL") {
    fail(`invalid marketplace policy for ${entry.name}`);
  }
  if (!entry.category) fail(`missing marketplace category for ${entry.name}`);
}

const claudeMarketplaceNames = new Set();
for (const entry of claudeMarketplace.plugins) {
  if (claudeMarketplaceNames.has(entry.name)) fail(`duplicate Claude marketplace plugin: ${entry.name}`);
  claudeMarketplaceNames.add(entry.name);
  if (entry.source !== `./plugins/${entry.name}`) fail(`invalid Claude marketplace source for ${entry.name}`);
  if (!entry.category) fail(`missing Claude marketplace category for ${entry.name}`);
}

for (const directory of pluginDirectories) {
  const prefix = `plugins/${directory}`;
  const codexManifest = readJson(`${prefix}/.codex-plugin/plugin.json`);
  const claudeManifest = readJson(`${prefix}/.claude-plugin/plugin.json`);
  const packageJson = readJson(`${prefix}/package.json`);
  const mcp = readJson(`${prefix}/.mcp.json`);
  if (codexManifest.name !== directory || claudeManifest.name !== directory) {
    fail(`${prefix} folder and manifest names differ`);
  }
  if (packageJson.name !== directory) fail(`${prefix} folder and package names differ`);
  if (codexManifest.version !== packageJson.version || claudeManifest.version !== packageJson.version) {
    fail(`${prefix} versions differ`);
  }
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(codexManifest.version)) {
    fail(`${prefix} version is not semver`);
  }
  if (!codexMarketplaceNames.has(directory) || !claudeMarketplaceNames.has(directory)) {
    fail(`${prefix} is missing from a marketplace`);
  }
  const registration = Object.values(mcp.mcpServers ?? {})[0];
  if (!registration || registration.command !== "node" || registration.args?.[0] !== "./dist/cli.js") {
    fail(`${prefix} does not launch its committed bundle`);
  }
  const claudeRegistration = Object.values(claudeManifest.mcpServers ?? {})[0];
  if (
    !claudeRegistration ||
    claudeRegistration.command !== "node" ||
    claudeRegistration.args?.[0] !== "${CLAUDE_PLUGIN_ROOT}/dist/cli.js"
  ) {
    fail(`${prefix} does not launch its committed bundle from Claude Code`);
  }
  if (directory === "mailbridge-mcp" && claudeRegistration.env?.MAILBRIDGE_MODE !== "prompted") {
    fail(`${prefix} Claude registration is not configured for per-send prompting`);
  }
  for (const path of [
    `${prefix}/dist/cli.js`,
    `${prefix}/README.md`,
    `${prefix}/skills`,
    `${prefix}/.claude-plugin/plugin.json`,
    `${prefix}/.codex-plugin/plugin.json`
  ]) {
    if (!existsSync(resolve(root, path))) fail(`required plugin payload is missing: ${path}`);
  }
}

for (const name of codexMarketplaceNames) {
  if (!pluginDirectories.includes(name)) fail(`Codex marketplace points to missing plugin: ${name}`);
}
for (const name of claudeMarketplaceNames) {
  if (!pluginDirectories.includes(name)) fail(`Claude marketplace points to missing plugin: ${name}`);
}

process.stdout.write(
  `Validated PMTechDev workspace with ${pluginDirectories.length} plugin(s): ${pluginDirectories.join(", ")}\n`
);
