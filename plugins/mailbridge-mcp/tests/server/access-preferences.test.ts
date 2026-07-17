import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { MailbridgeConfig, MailbridgeMode } from "../../src/config.js";
import type { LocalPreferencesContext } from "../../src/local-config.js";
import { MailbridgeToolService } from "../../src/server/index.js";
import { createFakeBridge } from "./fake-bridge.js";

function config(mode: MailbridgeMode = "read-only"): MailbridgeConfig {
  return {
    mode,
    allowedAccounts: undefined,
    maxResults: 10,
    maxBodyChars: 1_000,
    timeoutMs: 5_000,
    searchBudgetMs: 4_000,
  };
}

describe("MailbridgeToolService — access preferences", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  async function localPreferencesContext(
    envOverrides: LocalPreferencesContext["envOverrides"] = { mode: false, allowedAccounts: false },
  ): Promise<LocalPreferencesContext> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mailbridge-access-prefs-"));
    tempDirs.push(dir);
    return { path: path.join(dir, "preferences.json"), envOverrides };
  }

  it("reports no saved preferences on a fresh setup, alongside the currently active config", async () => {
    const { bridge } = createFakeBridge();
    const context = await localPreferencesContext();
    const service = new MailbridgeToolService(bridge, config("read-only"), undefined, context);

    const result = await service.invoke("mailbridge_get_access_preferences", {});

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: true,
      data: {
        found: false,
        path: context.path,
        activeMode: "read-only",
        activeAllowedAccounts: undefined,
        shadowedByEnvironment: { mode: false, allowedAccounts: false },
      },
    });
  });

  it("saves preferences starting from read-only mode, reporting matched and unmatched accounts", async () => {
    const { bridge, spies } = createFakeBridge();
    spies.listAccounts.mockResolvedValue([
      { id: "account:1", name: "Work", emailAddresses: ["work@example.com"], enabled: true },
    ]);
    const context = await localPreferencesContext();
    const service = new MailbridgeToolService(bridge, config("read-only"), undefined, context);

    const result = await service.invoke("mailbridge_set_access_preferences", {
      mode: "prompted",
      allowedAccounts: ["work@example.com", "unknown@example.com"],
      confirmed: true,
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: true,
      data: {
        saved: true,
        mode: "prompted",
        allowedAccounts: ["work@example.com", "unknown@example.com"],
        verification: {
          performed: true,
          matchedAccounts: ["work@example.com"],
          unmatchedAccounts: ["unknown@example.com"],
        },
        effectiveImmediately: false,
        appliesAfter: "restart-or-reconnect",
      },
    });

    const saved = await service.invoke("mailbridge_get_access_preferences", {});
    expect(saved.structuredContent).toMatchObject({
      ok: true,
      data: {
        found: true,
        savedMode: "prompted",
        savedAllowedAccounts: ["work@example.com", "unknown@example.com"],
        activeMode: "read-only",
      },
    });
  });

  it("rejects an attempt to save direct send mode, since a model-set confirmed:true is not an independent human confirmation", async () => {
    const { bridge } = createFakeBridge();
    const context = await localPreferencesContext();
    const service = new MailbridgeToolService(bridge, config("read-only"), undefined, context);

    const result = await service.invoke("mailbridge_set_access_preferences", {
      mode: "send",
      allowedAccounts: ["person@example.com"],
      confirmed: true,
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    await expect(fs.access(context.path)).rejects.toThrow();
  });

  it("still saves when live account verification fails, and says so instead of blocking", async () => {
    const { bridge, spies } = createFakeBridge();
    spies.listAccounts.mockRejectedValue(new Error("automation unavailable"));
    const context = await localPreferencesContext();
    const service = new MailbridgeToolService(bridge, config("read-only"), undefined, context);

    const result = await service.invoke("mailbridge_set_access_preferences", {
      mode: "drafts",
      allowedAccounts: ["person@example.com"],
      confirmed: true,
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: true,
      data: { saved: true, verification: { performed: false } },
    });
  });

  it("rejects an unconfirmed or empty request and writes nothing", async () => {
    const { bridge } = createFakeBridge();
    const context = await localPreferencesContext();
    const service = new MailbridgeToolService(bridge, config("read-only"), undefined, context);

    const unconfirmed = await service.invoke("mailbridge_set_access_preferences", {
      mode: "prompted",
      allowedAccounts: ["person@example.com"],
      confirmed: false,
    });
    const empty = await service.invoke("mailbridge_set_access_preferences", {
      mode: "prompted",
      allowedAccounts: [],
      confirmed: true,
    });

    expect(unconfirmed.isError).toBe(true);
    expect(unconfirmed.structuredContent).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    expect(empty.isError).toBe(true);
    expect(empty.structuredContent).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    await expect(fs.access(context.path)).rejects.toThrow();
  });

  it("maps a local write failure to a stable, safe error code", async () => {
    const { bridge } = createFakeBridge();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mailbridge-access-prefs-"));
    tempDirs.push(dir);
    // A regular file where a directory segment is expected forces mkdir to fail.
    const blockingFile = path.join(dir, "blocked");
    await fs.writeFile(blockingFile, "not a directory");
    const context: LocalPreferencesContext = {
      path: path.join(blockingFile, "sub", "preferences.json"),
      envOverrides: { mode: false, allowedAccounts: false },
    };
    const service = new MailbridgeToolService(bridge, config("read-only"), undefined, context);

    const result = await service.invoke("mailbridge_set_access_preferences", {
      mode: "prompted",
      allowedAccounts: ["person@example.com"],
      confirmed: true,
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: { code: "LOCAL_PREFERENCES_WRITE_FAILED" },
    });
  });

  it("reports which fields are shadowed by an explicitly set environment variable", async () => {
    const { bridge } = createFakeBridge();
    const context = await localPreferencesContext({ mode: true, allowedAccounts: false });
    const service = new MailbridgeToolService(bridge, config("prompted"), undefined, context);

    const result = await service.invoke("mailbridge_get_access_preferences", {});

    expect(result.structuredContent).toMatchObject({
      ok: true,
      data: { shadowedByEnvironment: { mode: true, allowedAccounts: false } },
    });
  });
});
