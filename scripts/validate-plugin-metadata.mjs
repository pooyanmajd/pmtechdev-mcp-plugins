import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import process from "node:process";
import { URL } from "node:url";

import { parse } from "yaml";

const root = process.cwd();
const ignoredDirectories = new Set([".git", "coverage", "dist", "node_modules", "release"]);
const errors = [];
const counts = { agents: 0, mcp: 0, plugins: 0, skills: 0 };
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const namePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const hexColorPattern = /^#[0-9A-F]{6}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function label(path) {
  return relative(root, path).split(sep).join("/");
}

function report(path, message) {
  errors.push(`${label(path)}: ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function substituteTemplatePlaceholders(path, source) {
  if (!label(path).startsWith("templates/")) return source;
  return source
    .replaceAll("__PLUGIN_NAME__", "example-plugin")
    .replaceAll("__PLUGIN_DISPLAY_NAME__", "Example Plugin");
}

function readSource(path) {
  return substituteTemplatePlaceholders(path, readFileSync(path, "utf8"));
}

function parseJsonObject(path) {
  try {
    const value = JSON.parse(readSource(path));
    if (!isRecord(value)) report(path, "must contain a JSON object");
    return isRecord(value) ? value : undefined;
  } catch (error) {
    report(path, `must contain valid JSON (${error instanceof Error ? error.message : "parse error"})`);
    return undefined;
  }
}

function parseYamlObject(path, source) {
  try {
    const value = parse(source, { uniqueKeys: true });
    if (!isRecord(value)) report(path, "must contain a YAML object");
    return isRecord(value) ? value : undefined;
  } catch (error) {
    report(path, `must contain valid YAML (${error instanceof Error ? error.message : "parse error"})`);
    return undefined;
  }
}

function rejectUnknown(path, value, allowed, prefix) {
  for (const key of Object.keys(value).sort()) {
    if (!allowed.has(key)) report(path, `${prefix}.${key} is not a supported field`);
  }
}

function nonEmptyString(path, value, field, { maximum } = {}) {
  if (typeof value !== "string" || value.trim().length === 0) {
    report(path, `${field} must be a non-empty string`);
    return undefined;
  }
  if (maximum !== undefined && value.length > maximum) {
    report(path, `${field} must be at most ${maximum} characters`);
  }
  return value;
}

function httpsUrl(path, value, field) {
  const text = nonEmptyString(path, value, field);
  if (text === undefined) return;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      report(path, `${field} must be an absolute HTTPS URL without embedded credentials`);
    }
  } catch {
    report(path, `${field} must be an absolute HTTPS URL`);
  }
}

function stringArray(path, value, field, { allowEmpty = false, maximumItems, maximumLength } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    report(path, `${field} must be ${allowEmpty ? "an" : "a non-empty"} array of strings`);
    return;
  }
  if (maximumItems !== undefined && value.length > maximumItems) {
    report(path, `${field} must contain at most ${maximumItems} entries`);
  }
  const seen = new Set();
  value.forEach((entry, index) => {
    const text = nonEmptyString(path, entry, `${field}[${index}]`, { maximum: maximumLength });
    if (text !== undefined && seen.has(text)) report(path, `${field} contains duplicate entry ${JSON.stringify(text)}`);
    if (text !== undefined) seen.add(text);
  });
}

function archivePath(path, base, value, field, { allowDot = false, expectedType = "file", extension } = {}) {
  const text = nonEmptyString(path, value, field);
  if (text === undefined) return;
  if (text !== "." && !text.startsWith("./")) {
    report(path, `${field} must start with ./`);
    return;
  }
  const target = resolve(base, text);
  const fromBase = relative(base, target);
  if (fromBase.startsWith(`..${sep}`) || fromBase === ".." || (fromBase === "" && !allowDot)) {
    report(path, `${field} must stay inside its plugin or skill directory`);
    return;
  }
  if (!existsSync(target)) {
    report(path, `${field} points to a missing path`);
    return;
  }
  const stat = statSync(target);
  if (expectedType === "file" && !stat.isFile()) report(path, `${field} must point to a file`);
  if (expectedType === "directory" && !stat.isDirectory()) report(path, `${field} must point to a directory`);
  if (extension !== undefined && !target.toLowerCase().endsWith(extension)) {
    report(path, `${field} must point to a ${extension} file`);
  }
}

function validateServerConfig(path, serverName, config, base) {
  const prefix = `mcpServers.${serverName}`;
  if (!isRecord(config)) {
    report(path, `${prefix} must be an object`);
    return;
  }
  rejectUnknown(path, config, new Set([
    "args", "bearer_token_env_var", "command", "cwd", "default_tools_approval_mode",
    "disabled_tools", "enabled", "enabled_tools", "env", "env_http_headers", "env_vars",
    "http_headers", "required", "startup_timeout_sec", "tool_timeout_sec", "tools", "type", "url",
  ]), prefix);

  const hasCommand = typeof config.command === "string" && config.command.trim().length > 0;
  const hasUrl = typeof config.url === "string" && config.url.trim().length > 0;
  if (hasCommand === hasUrl) report(path, `${prefix} must define exactly one of command or url`);
  if (hasCommand) nonEmptyString(path, config.command, `${prefix}.command`);
  if (hasUrl) httpsUrl(path, config.url, `${prefix}.url`);

  if (config.type !== undefined) {
    const type = nonEmptyString(path, config.type, `${prefix}.type`);
    if (type !== undefined && !["http", "sse", "stdio", "streamable_http"].includes(type)) {
      report(path, `${prefix}.type is not a supported transport`);
    }
    if (hasCommand && type !== undefined && type !== "stdio") report(path, `${prefix}.type must be stdio when command is used`);
    if (hasUrl && type === "stdio") report(path, `${prefix}.type cannot be stdio when url is used`);
  }
  if (config.args !== undefined) stringArray(path, config.args, `${prefix}.args`, { allowEmpty: true });
  if (config.cwd !== undefined) archivePath(path, base, config.cwd, `${prefix}.cwd`, { allowDot: true, expectedType: "directory" });
  for (const field of ["env", "env_http_headers", "http_headers"]) {
    if (config[field] === undefined) continue;
    if (!isRecord(config[field])) {
      report(path, `${prefix}.${field} must be an object of string values`);
      continue;
    }
    for (const [key, value] of Object.entries(config[field])) {
      nonEmptyString(path, key, `${prefix}.${field} key`);
      nonEmptyString(path, value, `${prefix}.${field}.${key}`);
    }
  }
  for (const field of ["bearer_token_env_var"]) {
    if (config[field] !== undefined) nonEmptyString(path, config[field], `${prefix}.${field}`);
  }
  for (const field of ["env_vars", "enabled_tools", "disabled_tools"]) {
    if (config[field] !== undefined) stringArray(path, config[field], `${prefix}.${field}`, { allowEmpty: true });
  }
  for (const field of ["enabled", "required"]) {
    if (config[field] !== undefined && typeof config[field] !== "boolean") report(path, `${prefix}.${field} must be a boolean`);
  }
  for (const field of ["startup_timeout_sec", "tool_timeout_sec"]) {
    if (config[field] !== undefined && (typeof config[field] !== "number" || !Number.isFinite(config[field]) || config[field] <= 0)) {
      report(path, `${prefix}.${field} must be a positive number`);
    }
  }
  if (config.default_tools_approval_mode !== undefined && !["approve", "deny", "prompt"].includes(config.default_tools_approval_mode)) {
    report(path, `${prefix}.default_tools_approval_mode must be approve, deny, or prompt`);
  }
  if (config.tools !== undefined && !isRecord(config.tools)) report(path, `${prefix}.tools must be an object`);
}

function validateMcpMap(path, servers, base) {
  if (!isRecord(servers) || Object.keys(servers).length === 0) {
    report(path, "mcpServers must be a non-empty object");
    return;
  }
  for (const [serverName, config] of Object.entries(servers)) {
    nonEmptyString(path, serverName, "MCP server name");
    validateServerConfig(path, serverName, config, base);
  }
}

function validateMcpManifest(path) {
  counts.mcp += 1;
  const payload = parseJsonObject(path);
  if (payload === undefined) return;
  rejectUnknown(path, payload, new Set(["mcpServers"]), "$" );
  validateMcpMap(path, payload.mcpServers, dirname(path));
}

function validatePluginManifest(path) {
  counts.plugins += 1;
  const manifest = parseJsonObject(path);
  if (manifest === undefined) return;
  const pluginRoot = dirname(dirname(path));
  const isTemplate = label(path).startsWith("templates/");
  rejectUnknown(path, manifest, new Set([
    "apps", "author", "description", "homepage", "id", "interface", "keywords", "license",
    "mcpServers", "name", "repository", "skills", "version",
  ]), "$" );

  if (manifest.id !== undefined) nonEmptyString(path, manifest.id, "id");
  const name = nonEmptyString(path, manifest.name, "name", { maximum: 64 });
  if (name !== undefined && !namePattern.test(name)) report(path, "name must use lowercase hyphen-case");
  if (!isTemplate && name !== undefined && name !== pluginRoot.split(sep).at(-1)) report(path, "name must match the plugin directory");
  const version = nonEmptyString(path, manifest.version, "version");
  if (version !== undefined && !semverPattern.test(version)) report(path, "version must be strict semver");
  nonEmptyString(path, manifest.description, "description");

  if (!isRecord(manifest.author)) {
    report(path, "author must be an object");
  } else {
    rejectUnknown(path, manifest.author, new Set(["email", "name", "url"]), "author");
    nonEmptyString(path, manifest.author.name, "author.name");
    if (manifest.author.email !== undefined) {
      const email = nonEmptyString(path, manifest.author.email, "author.email");
      if (email !== undefined && !emailPattern.test(email)) report(path, "author.email must be a valid email address");
    }
    if (manifest.author.url !== undefined) httpsUrl(path, manifest.author.url, "author.url");
  }
  for (const field of ["homepage", "repository"]) {
    if (manifest[field] !== undefined) httpsUrl(path, manifest[field], field);
  }
  if (manifest.license !== undefined) nonEmptyString(path, manifest.license, "license");
  if (manifest.keywords !== undefined) stringArray(path, manifest.keywords, "keywords");
  if (manifest.skills !== undefined) archivePath(path, pluginRoot, manifest.skills, "skills", { expectedType: "directory" });
  if (manifest.apps !== undefined) archivePath(path, pluginRoot, manifest.apps, "apps");
  if (typeof manifest.mcpServers === "string") archivePath(path, pluginRoot, manifest.mcpServers, "mcpServers");
  else if (manifest.mcpServers !== undefined) validateMcpMap(path, manifest.mcpServers, pluginRoot);

  if (!isRecord(manifest.interface)) {
    report(path, "interface must be an object");
    return;
  }
  const ui = manifest.interface;
  rejectUnknown(path, ui, new Set([
    "brandColor", "capabilities", "category", "composerIcon", "defaultPrompt", "default_prompt",
    "developerName", "displayName", "logo", "logoDark", "longDescription", "privacyPolicyURL",
    "screenshots", "shortDescription", "termsOfServiceURL", "websiteURL",
  ]), "interface");
  for (const field of ["displayName", "shortDescription", "longDescription", "developerName", "category"]) {
    nonEmptyString(path, ui[field], `interface.${field}`);
  }
  stringArray(path, ui.capabilities, "interface.capabilities");
  if (ui.defaultPrompt !== undefined && ui.default_prompt !== undefined) report(path, "interface must not define both defaultPrompt and default_prompt");
  const prompts = ui.defaultPrompt ?? ui.default_prompt;
  stringArray(path, prompts, "interface.defaultPrompt", { maximumItems: 3, maximumLength: 128 });
  for (const field of ["websiteURL", "privacyPolicyURL", "termsOfServiceURL"]) {
    if (ui[field] !== undefined) httpsUrl(path, ui[field], `interface.${field}`);
  }
  if (ui.brandColor !== undefined && (typeof ui.brandColor !== "string" || !hexColorPattern.test(ui.brandColor))) {
    report(path, "interface.brandColor must use #RRGGBB");
  }
  for (const field of ["composerIcon", "logo", "logoDark"]) {
    if (ui[field] !== undefined) archivePath(path, pluginRoot, ui[field], `interface.${field}`);
  }
  if (ui.screenshots !== undefined) {
    if (!Array.isArray(ui.screenshots) || ui.screenshots.length === 0) report(path, "interface.screenshots must be a non-empty array");
    else ui.screenshots.forEach((entry, index) => archivePath(path, pluginRoot, entry, `interface.screenshots[${index}]`, { extension: ".png" }));
  }
}

function readSkillFrontmatter(path) {
  const source = readSource(path);
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (match === null) {
    report(path, "must start with closed YAML frontmatter");
    return undefined;
  }
  const frontmatter = parseYamlObject(path, match[1]);
  if (source.slice(match[0].length).trim().length === 0) report(path, "must contain skill instructions after the frontmatter");
  return frontmatter;
}

function validateSkill(path) {
  counts.skills += 1;
  const frontmatter = readSkillFrontmatter(path);
  if (frontmatter === undefined) return;
  const isTemplate = label(path).startsWith("templates/");
  const skillRoot = dirname(path);
  rejectUnknown(path, frontmatter, new Set(["allowed-tools", "description", "license", "metadata", "name"]), "frontmatter");
  const name = nonEmptyString(path, frontmatter.name, "frontmatter.name", { maximum: 64 });
  if (name !== undefined && !namePattern.test(name)) report(path, "frontmatter.name must use lowercase hyphen-case");
  if (!isTemplate && name !== undefined && name !== skillRoot.split(sep).at(-1)) report(path, "frontmatter.name must match the skill directory");
  const description = nonEmptyString(path, frontmatter.description, "frontmatter.description", { maximum: 1024 });
  if (description !== undefined && /[<>]/.test(description)) report(path, "frontmatter.description cannot contain angle brackets");
  if (frontmatter.license !== undefined) nonEmptyString(path, frontmatter.license, "frontmatter.license");
  if (frontmatter["allowed-tools"] !== undefined) {
    if (typeof frontmatter["allowed-tools"] === "string") nonEmptyString(path, frontmatter["allowed-tools"], "frontmatter.allowed-tools");
    else stringArray(path, frontmatter["allowed-tools"], "frontmatter.allowed-tools");
  }
  if (frontmatter.metadata !== undefined && !isRecord(frontmatter.metadata)) report(path, "frontmatter.metadata must be an object");
}

function validateAgentMetadata(path) {
  counts.agents += 1;
  const payload = parseYamlObject(path, readSource(path));
  if (payload === undefined) return;
  const skillRoot = dirname(dirname(path));
  const skillPath = resolve(skillRoot, "SKILL.md");
  const skill = existsSync(skillPath) ? readSkillFrontmatter(skillPath) : undefined;
  const skillName = skill?.name;
  if (!existsSync(skillPath)) report(path, "must have a sibling skill SKILL.md");
  rejectUnknown(path, payload, new Set(["dependencies", "interface", "policy"]), "$" );
  if (!isRecord(payload.interface)) {
    report(path, "interface must be an object");
  } else {
    const ui = payload.interface;
    rejectUnknown(path, ui, new Set(["brand_color", "default_prompt", "display_name", "icon_large", "icon_small", "short_description"]), "interface");
    nonEmptyString(path, ui.display_name, "interface.display_name");
    const short = nonEmptyString(path, ui.short_description, "interface.short_description");
    if (short !== undefined && (short.length < 25 || short.length > 64)) report(path, "interface.short_description must be 25-64 characters");
    for (const field of ["icon_small", "icon_large"]) {
      if (ui[field] !== undefined) archivePath(path, skillRoot, ui[field], `interface.${field}`);
    }
    if (ui.brand_color !== undefined && (typeof ui.brand_color !== "string" || !hexColorPattern.test(ui.brand_color))) {
      report(path, "interface.brand_color must use #RRGGBB");
    }
    if (ui.default_prompt !== undefined) {
      const prompt = nonEmptyString(path, ui.default_prompt, "interface.default_prompt");
      if (prompt !== undefined && typeof skillName === "string" && !prompt.includes(`$${skillName}`)) {
        report(path, `interface.default_prompt must mention $${skillName}`);
      }
    }
  }
  if (payload.policy !== undefined) {
    if (!isRecord(payload.policy)) report(path, "policy must be an object");
    else {
      rejectUnknown(path, payload.policy, new Set(["allow_implicit_invocation"]), "policy");
      if (payload.policy.allow_implicit_invocation !== undefined && typeof payload.policy.allow_implicit_invocation !== "boolean") {
        report(path, "policy.allow_implicit_invocation must be a boolean");
      }
    }
  }
  if (payload.dependencies !== undefined) {
    if (!isRecord(payload.dependencies)) report(path, "dependencies must be an object");
    else {
      rejectUnknown(path, payload.dependencies, new Set(["tools"]), "dependencies");
      if (!Array.isArray(payload.dependencies.tools) || payload.dependencies.tools.length === 0) report(path, "dependencies.tools must be a non-empty array");
      else payload.dependencies.tools.forEach((tool, index) => {
        const prefix = `dependencies.tools[${index}]`;
        if (!isRecord(tool)) {
          report(path, `${prefix} must be an object`);
          return;
        }
        rejectUnknown(path, tool, new Set(["description", "transport", "type", "url", "value"]), prefix);
        if (tool.type !== "mcp") report(path, `${prefix}.type must be mcp`);
        nonEmptyString(path, tool.value, `${prefix}.value`);
        nonEmptyString(path, tool.description, `${prefix}.description`);
        const transport = nonEmptyString(path, tool.transport, `${prefix}.transport`);
        if (transport !== undefined && !["sse", "stdio", "streamable_http"].includes(transport)) report(path, `${prefix}.transport is not supported`);
        if (tool.url !== undefined) httpsUrl(path, tool.url, `${prefix}.url`);
        if (transport !== "stdio" && tool.url === undefined) report(path, `${prefix}.url is required for remote MCP transports`);
      });
    }
  }
}

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      walk(path);
      continue;
    }
    if (!entry.isFile()) continue;
    const parent = dirname(path).split(sep).at(-1);
    if (entry.name === "plugin.json" && parent === ".codex-plugin") validatePluginManifest(path);
    else if (entry.name === ".mcp.json") validateMcpManifest(path);
    else if (entry.name === "SKILL.md") validateSkill(path);
    else if (entry.name === "openai.yaml" && parent === "agents") validateAgentMetadata(path);
  }
}

walk(root);
for (const [kind, count] of Object.entries(counts)) {
  if (count === 0) errors.push(`No ${kind} metadata files were found`);
}
if (errors.length > 0) {
  process.stderr.write(`Plugin metadata validation failed:\n- ${errors.join("\n- ")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Validated ${counts.plugins} plugin manifest(s), ${counts.mcp} MCP manifest(s), ${counts.skills} skill(s), and ${counts.agents} agent metadata file(s).\n`);
}
