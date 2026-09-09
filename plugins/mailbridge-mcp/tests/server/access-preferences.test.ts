import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

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

function proposalId(result: Awaited<ReturnType<MailbridgeToolService["invoke"]>>): string {
  const meta = result._meta?.["mailbridge/accessProposal"] as { proposalId?: unknown } | undefined;
  if (typeof meta?.proposalId !== "string") throw new Error("Missing proposal ID in private result metadata.");
  return meta.proposalId;
}

describe("MailbridgeToolService — access preferences", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(tempDirs.splice(0).map(async (dir) => fs.rm(dir, { recursive: true, force: true })));
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

  it("prepares an exact private proposal, then saves only through the app commit tool", async () => {
    const { bridge, spies } = createFakeBridge();
    spies.listAccounts.mockResolvedValue([
      { id: "account:1", name: "Work", emailAddresses: ["work@example.com"], enabled: true },
    ]);
    const context = await localPreferencesContext();
    const service = new MailbridgeToolService(bridge, config("read-only"), undefined, context);

    const prepared = await service.invoke("mailbridge_set_access_preferences", {
      mode: "prompted",
      allowedAccounts: ["WORK@example.com", "unknown@example.com"],
    });

    expect(prepared.isError).not.toBe(true);
    expect(prepared.structuredContent).toMatchObject({
      ok: true,
      data: {
        status: "awaiting-user",
        activeMode: "read-only",
        proposedMode: "prompted",
        proposedAllowedAccounts: ["work@example.com", "unknown@example.com"],
        verification: {
          performed: true,
          matchedAccounts: ["work@example.com"],
          unmatchedAccounts: ["unknown@example.com"],
        },
      },
    });
    const id = proposalId(prepared);
    expect(JSON.stringify(prepared.structuredContent)).not.toContain(id);
    const visibleText = prepared.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    expect(visibleText).not.toContain(id);
    await expect(fs.readFile(context.path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    const committed = await service.invoke("mailbridge_commit_access_preferences", { proposalId: id });

    expect(committed.isError).not.toBe(true);
    expect(committed.structuredContent).toMatchObject({
      ok: true,
      data: {
        saved: true,
        mode: "prompted",
        allowedAccounts: ["work@example.com", "unknown@example.com"],
        effectiveImmediately: false,
        appliesAfter: "restart-or-reconnect",
      },
    });
    await expect(fs.readFile(context.path, "utf8")).resolves.toContain('"mode": "prompted"');
  });

  it("rejects direct send mode before creating any proposal", async () => {
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
    expect(result._meta).toBeUndefined();
    await expect(fs.access(context.path)).rejects.toThrow();
  });

  it("shows a verification warning in the proposal when Mail.app lookup fails", async () => {
    const { bridge, spies } = createFakeBridge();
    spies.listAccounts.mockRejectedValue(new Error("automation unavailable"));
    const context = await localPreferencesContext();
    const service = new MailbridgeToolService(bridge, config("read-only"), undefined, context);

    const prepared = await service.invoke("mailbridge_set_access_preferences", {
      mode: "drafts",
      allowedAccounts: ["person@example.com"],
    });

    expect(prepared.structuredContent).toMatchObject({
      ok: true,
      data: { status: "awaiting-user", verification: { performed: false } },
    });
    await expect(fs.access(context.path)).rejects.toThrow();

    const committed = await service.invoke("mailbridge_commit_access_preferences", {
      proposalId: proposalId(prepared),
    });
    expect(committed.structuredContent).toMatchObject({
      ok: true,
      data: { saved: true, verification: { performed: false } },
    });
  });

  it("rejects legacy confirmed:false, an empty account list, and invalid commit tokens", async () => {
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
    });
    const invalidToken = await service.invoke("mailbridge_commit_access_preferences", {
      proposalId: "not-a-uuid",
    });
    const unknownToken = await service.invoke("mailbridge_commit_access_preferences", {
      proposalId: "00000000-0000-4000-8000-000000000000",
    });

    for (const result of [unconfirmed, empty, invalidToken]) {
      expect(result.structuredContent).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    }
    expect(unknownToken.structuredContent).toMatchObject({
      ok: false,
      error: { code: "PREFERENCES_PROPOSAL_EXPIRED" },
    });
    await expect(fs.access(context.path)).rejects.toThrow();
  });

  it("makes commit idempotent so a retried card click cannot write a different value", async () => {
    const { bridge } = createFakeBridge();
    const context = await localPreferencesContext();
    const service = new MailbridgeToolService(bridge, config("read-only"), undefined, context);
    const prepared = await service.invoke("mailbridge_set_access_preferences", {
      mode: "full",
      allowedAccounts: ["person@example.com"],
    });
    const id = proposalId(prepared);

    const [first, retry] = await Promise.all([
      service.invoke("mailbridge_commit_access_preferences", { proposalId: id }),
      service.invoke("mailbridge_commit_access_preferences", { proposalId: id }),
    ]);

    expect(first.structuredContent).toEqual(retry.structuredContent);
    await expect(fs.readFile(context.path, "utf8")).resolves.toContain('"mode": "full"');
  });

  it("surfaces an unreadable saved file in the card and leaves it untouched until Save access", async () => {
    const { bridge } = createFakeBridge();
    const context = await localPreferencesContext();
    await fs.writeFile(context.path, "not valid json");
    const service = new MailbridgeToolService(bridge, config("read-only"), undefined, context);

    const prepared = await service.invoke("mailbridge_set_access_preferences", {
      mode: "drafts",
      allowedAccounts: ["person@example.com"],
    });

    expect(prepared.structuredContent).toMatchObject({
      ok: true,
      data: { savedMode: undefined, savedAllowedAccounts: undefined },
    });
    expect((prepared.structuredContent as { data?: { savedPreferencesDiagnostic?: unknown } }).data
      ?.savedPreferencesDiagnostic).toBeTypeOf("string");
    await expect(fs.readFile(context.path, "utf8")).resolves.toBe("not valid json");

    await service.invoke("mailbridge_commit_access_preferences", { proposalId: proposalId(prepared) });
    await expect(fs.readFile(context.path, "utf8")).resolves.toContain('"mode": "drafts"');
  });

  it("bounds short-lived access proposals and expires the oldest card", async () => {
    const { bridge } = createFakeBridge();
    const context = await localPreferencesContext();
    const service = new MailbridgeToolService(bridge, config("read-only"), undefined, context);
    const ids: string[] = [];

    for (let index = 0; index < 7; index += 1) {
      const prepared = await service.invoke("mailbridge_set_access_preferences", {
        mode: "drafts",
        allowedAccounts: [`person${index}@example.com`],
      });
      ids.push(proposalId(prepared));
    }

    const expired = await service.invoke("mailbridge_commit_access_preferences", { proposalId: ids[0] });
    expect(expired.structuredContent).toMatchObject({
      ok: false,
      error: { code: "PREFERENCES_PROPOSAL_EXPIRED" },
    });
    const oldestRemaining = await service.invoke("mailbridge_commit_access_preferences", { proposalId: ids[1] });
    expect(oldestRemaining.structuredContent).toMatchObject({ ok: true, data: { saved: true } });
    const newest = await service.invoke("mailbridge_commit_access_preferences", { proposalId: ids.at(-1) });
    expect(newest.structuredContent).toMatchObject({ ok: true, data: { saved: true } });
  });

  it("keeps all six proposals usable when the proposal store is full", async () => {
    const { bridge } = createFakeBridge();
    const context = await localPreferencesContext();
    const service = new MailbridgeToolService(bridge, config(), undefined, context);
    const ids: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      ids.push(proposalId(await service.invoke("mailbridge_set_access_preferences", {
        mode: "drafts",
        allowedAccounts: [`person${index}@example.com`],
      })));
    }
    for (const id of ids) {
      const result = await service.invoke("mailbridge_commit_access_preferences", { proposalId: id });
      expect(result.structuredContent).toMatchObject({ ok: true, data: { saved: true } });
    }
  });

  it("expires proposals at their ten-minute deadline without writing", async () => {
    const { bridge } = createFakeBridge();
    const context = await localPreferencesContext();
    const service = new MailbridgeToolService(bridge, config(), undefined, context);
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const prepared = await service.invoke("mailbridge_set_access_preferences", {
      mode: "drafts", allowedAccounts: ["person@example.com"],
    });
    now.mockReturnValue(1_000 + 10 * 60 * 1_000);
    const result = await service.invoke("mailbridge_commit_access_preferences", { proposalId: proposalId(prepared) });
    expect(result.structuredContent).toMatchObject({ ok: false, error: { code: "PREFERENCES_PROPOSAL_EXPIRED" } });
    await expect(fs.access(context.path)).rejects.toThrow();
  });

  it("maps a local write failure to a stable, safe error code", async () => {
    const { bridge } = createFakeBridge();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mailbridge-access-prefs-"));
    tempDirs.push(dir);
    const blockingFile = path.join(dir, "blocked");
    await fs.writeFile(blockingFile, "not a directory");
    const context: LocalPreferencesContext = {
      path: path.join(blockingFile, "sub", "preferences.json"),
      envOverrides: { mode: false, allowedAccounts: false },
    };
    const service = new MailbridgeToolService(bridge, config("read-only"), undefined, context);
    const prepared = await service.invoke("mailbridge_set_access_preferences", {
      mode: "prompted",
      allowedAccounts: ["person@example.com"],
    });

    const result = await service.invoke("mailbridge_commit_access_preferences", {
      proposalId: proposalId(prepared),
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
