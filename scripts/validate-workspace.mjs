import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const root = process.cwd();
const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const fail = (message) => {
  throw new Error(`Workspace validation failed: ${message}`);
};

const rootPackage = readJson("package.json");
const marketplace = readJson(".agents/plugins/marketplace.json");
const pluginRoot = resolve(root, "plugins");
const pluginDirectories = readdirSync(pluginRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

if (rootPackage.name !== "pmtechdev-mcp-plugins") fail("unexpected root package name");
if (!rootPackage.workspaces?.includes("plugins/*") || !rootPackage.workspaces?.includes("packages/*")) {
  fail("root workspaces must include plugins/* and packages/*");
}
if (marketplace.name !== "pmtechdev") fail("marketplace name must be pmtechdev");
if (!Array.isArray(marketplace.plugins)) fail("marketplace plugins must be an array");
for (const path of [
  "packages/mcp-kit/src/index.ts",
  "templates/mcp-plugin/.codex-plugin/plugin.json",
  "scripts/create-plugin.mjs"
]) {
  if (!existsSync(resolve(root, path))) fail(`required reusable workspace asset is missing: ${path}`);
}

const marketplaceNames = new Set();
for (const entry of marketplace.plugins) {
  if (marketplaceNames.has(entry.name)) fail(`duplicate marketplace plugin: ${entry.name}`);
  marketplaceNames.add(entry.name);
  if (entry.source?.source !== "local" || entry.source?.path !== `./plugins/${entry.name}`) {
    fail(`invalid marketplace source for ${entry.name}`);
  }
  if (entry.policy?.installation !== "AVAILABLE" || entry.policy?.authentication !== "ON_INSTALL") {
    fail(`invalid marketplace policy for ${entry.name}`);
  }
  if (!entry.category) fail(`missing marketplace category for ${entry.name}`);
}

for (const directory of pluginDirectories) {
  const prefix = `plugins/${directory}`;
  const manifest = readJson(`${prefix}/.codex-plugin/plugin.json`);
  const packageJson = readJson(`${prefix}/package.json`);
  const mcp = readJson(`${prefix}/.mcp.json`);
  if (manifest.name !== directory) fail(`${prefix} folder and manifest names differ`);
  if (packageJson.name !== directory) fail(`${prefix} folder and package names differ`);
  if (manifest.version !== packageJson.version) fail(`${prefix} versions differ`);
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(manifest.version)) {
    fail(`${prefix} version is not semver`);
  }
  if (!marketplaceNames.has(directory)) fail(`${prefix} is missing from the marketplace`);
  const registration = Object.values(mcp.mcpServers ?? {})[0];
  if (!registration || registration.command !== "node" || registration.args?.[0] !== "./dist/cli.js") {
    fail(`${prefix} does not launch its committed bundle`);
  }
  for (const path of [
    `${prefix}/dist/cli.js`,
    `${prefix}/README.md`,
    `${prefix}/skills`,
    `${prefix}/.codex-plugin/plugin.json`
  ]) {
    if (!existsSync(resolve(root, path))) fail(`required plugin payload is missing: ${path}`);
  }
}

for (const name of marketplaceNames) {
  if (!pluginDirectories.includes(name)) fail(`marketplace points to missing plugin: ${name}`);
}

process.stdout.write(
  `Validated PMTechDev workspace with ${pluginDirectories.length} plugin(s): ${pluginDirectories.join(", ")}\n`
);
