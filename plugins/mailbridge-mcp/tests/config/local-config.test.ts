import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "../../src/config.js";
import {
  defaultLocalPreferencesContext,
  isEnvValueSet,
  overlayLocalPreferences,
  readLocalPreferences,
  resolveLocalConfigPath,
  writeLocalPreferences,
} from "../../src/local-config.js";

describe("isEnvValueSet", () => {
  it("treats undefined and blank strings as unset", () => {
    expect(isEnvValueSet(undefined)).toBe(false);
    expect(isEnvValueSet("")).toBe(false);
    expect(isEnvValueSet("   ")).toBe(false);
    expect(isEnvValueSet("send")).toBe(true);
  });
});

describe("resolveLocalConfigPath", () => {
  it("defaults to the macOS Application Support location", () => {
    expect(resolveLocalConfigPath({}, "/Users/example")).toBe(
      "/Users/example/Library/Application Support/mailbridge-mcp/preferences.json",
    );
  });

  it("honors an absolute XDG_CONFIG_HOME override", () => {
    expect(resolveLocalConfigPath({ XDG_CONFIG_HOME: "/custom/config" }, "/Users/example")).toBe(
      "/custom/config/mailbridge-mcp/preferences.json",
    );
  });

  it("ignores a blank or relative XDG_CONFIG_HOME", () => {
    expect(resolveLocalConfigPath({ XDG_CONFIG_HOME: "" }, "/Users/example")).toBe(
      "/Users/example/Library/Application Support/mailbridge-mcp/preferences.json",
    );
    expect(resolveLocalConfigPath({ XDG_CONFIG_HOME: "relative/path" }, "/Users/example")).toBe(
      "/Users/example/Library/Application Support/mailbridge-mcp/preferences.json",
    );
  });
});

describe("defaultLocalPreferencesContext", () => {
  it("reports which fields are already overridden by the environment", () => {
    const context = defaultLocalPreferencesContext(
      { MAILBRIDGE_MODE: "send", MAILBRIDGE_ALLOWED_ACCOUNTS: "" },
      "/Users/example",
    );
    expect(context.envOverrides).toEqual({ mode: true, allowedAccounts: false });
    expect(context.path).toBe("/Users/example/Library/Application Support/mailbridge-mcp/preferences.json");
  });
});

describe("overlayLocalPreferences", () => {
  const preferences = { mode: "send" as const, allowedAccounts: ["a@example.com", "b@example.com"], updatedAt: "2026-07-17T00:00:00.000Z" };

  it("passes the environment through unchanged when there are no saved preferences", () => {
    const env = { MAILBRIDGE_MODE: "read-only" };
    expect(overlayLocalPreferences(env, undefined)).toEqual(env);
  });

  it("lets an explicitly set environment variable win over saved preferences", () => {
    const env = { MAILBRIDGE_MODE: "read-only", MAILBRIDGE_ALLOWED_ACCOUNTS: "c@example.com" };
    expect(overlayLocalPreferences(env, preferences)).toMatchObject({
      MAILBRIDGE_MODE: "read-only",
      MAILBRIDGE_ALLOWED_ACCOUNTS: "c@example.com",
    });
  });

  it("fills in fields the environment leaves blank or unset", () => {
    expect(overlayLocalPreferences({ MAILBRIDGE_MODE: "" }, preferences)).toMatchObject({
      MAILBRIDGE_MODE: "send",
      MAILBRIDGE_ALLOWED_ACCOUNTS: "a@example.com,b@example.com",
    });
  });
});

describe("readLocalPreferences / writeLocalPreferences (real filesystem)", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  async function tempPreferencesPath(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mailbridge-local-config-"));
    tempDirs.push(dir);
    return path.join(dir, "nested", "preferences.json");
  }

  it("reports no preferences and no diagnostic for a missing file", async () => {
    const filePath = await tempPreferencesPath();
    const result = await readLocalPreferences(filePath);
    expect(result).toEqual({ preferences: undefined, diagnostic: undefined });
  });

  it("writes with restrictive permissions and reads the value back", async () => {
    const filePath = await tempPreferencesPath();

    const written = await writeLocalPreferences(filePath, {
      mode: "send",
      allowedAccounts: ["Person@Example.com", "person@example.com", " other@example.com "],
    });
    expect(written.mode).toBe("send");
    expect(written.allowedAccounts).toEqual(["person@example.com", "other@example.com"]);

    const dirStat = await fs.stat(path.dirname(filePath));
    const fileStat = await fs.stat(filePath);
    expect(dirStat.mode & 0o777).toBe(0o700);
    expect(fileStat.mode & 0o777).toBe(0o600);

    const read = await readLocalPreferences(filePath);
    expect(read.diagnostic).toBeUndefined();
    expect(read.preferences).toEqual(written);
  });

  it("ignores a corrupt file and reports a safe diagnostic without deleting it", async () => {
    const filePath = await tempPreferencesPath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "{not valid json");

    const result = await readLocalPreferences(filePath);

    expect(result.preferences).toBeUndefined();
    expect(result.diagnostic).toBeDefined();
    expect(result.diagnostic).not.toContain(filePath);
    await expect(fs.readFile(filePath, "utf8")).resolves.toBe("{not valid json");
  });

  it("ignores a schema-invalid file and reports a diagnostic", async () => {
    const filePath = await tempPreferencesPath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({ schemaVersion: 1, mode: "not-a-mode", allowedAccounts: [] }));

    const result = await readLocalPreferences(filePath);

    expect(result.preferences).toBeUndefined();
    expect(result.diagnostic).toBeDefined();
  });

  it("cleans up its temp file and rethrows when the final rename fails", async () => {
    const filePath = await tempPreferencesPath();
    // Pre-create a directory at the destination so the final rename fails (EISDIR/ENOTEMPTY)
    // after the temp file has already been written successfully.
    await fs.mkdir(filePath, { recursive: true });

    await expect(
      writeLocalPreferences(filePath, { mode: "send", allowedAccounts: ["person@example.com"] }),
    ).rejects.toThrow();

    const leftoverEntries = await fs.readdir(path.dirname(filePath));
    expect(leftoverEntries.filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
  });

  it("never produces a value the real loadConfig rejects when mode is send and env leaves the allowlist unset", async () => {
    const filePath = await tempPreferencesPath();
    await writeLocalPreferences(filePath, { mode: "send", allowedAccounts: ["sender@example.com"] });
    const { preferences } = await readLocalPreferences(filePath);

    const env = overlayLocalPreferences({ MAILBRIDGE_MODE: "send" }, preferences);

    expect(() => loadConfig(env)).not.toThrow();
    expect(loadConfig(env)).toMatchObject({ mode: "send", allowedAccounts: ["sender@example.com"] });
  });
});
