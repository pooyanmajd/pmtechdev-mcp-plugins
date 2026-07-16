import { cp, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const requestedName = process.argv[2] ?? "";
const normalizedName = requestedName
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 64);
if (!normalizedName || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalizedName)) {
  throw new Error("Usage: npm run create:plugin -- <lowercase-plugin-name>");
}

const displayName = normalizedName
  .split("-")
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(" ");
const target = resolve(root, "plugins", normalizedName);
try {
  await stat(target);
  throw new Error(`Plugin already exists: plugins/${normalizedName}`);
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}

await cp(resolve(root, "templates/mcp-plugin"), target, { recursive: true, errorOnExist: true });

async function replaceTokens(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await replaceTokens(path);
      continue;
    }
    const original = await readFile(path, "utf8");
    const updated = original
      .replaceAll("__PLUGIN_NAME__", normalizedName)
      .replaceAll("__PLUGIN_DISPLAY_NAME__", displayName);
    await writeFile(path, updated, "utf8");
  }
}

await replaceTokens(target);
await rename(resolve(target, "skills/plugin"), resolve(target, `skills/${normalizedName}`));

const marketplacePath = resolve(root, ".agents/plugins/marketplace.json");
const marketplace = JSON.parse(await readFile(marketplacePath, "utf8"));
marketplace.plugins.push({
  name: normalizedName,
  source: { source: "local", path: `./plugins/${normalizedName}` },
  policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
  category: "Developer Tools"
});
await writeFile(marketplacePath, `${JSON.stringify(marketplace, null, 2)}\n`, "utf8");

process.stdout.write(
  [
    `Created plugins/${normalizedName}`,
    "Next:",
    "  npm install",
    `  npm run check -w ${normalizedName}`,
    "  npm run validate:workspace"
  ].join("\n") + "\n"
);
