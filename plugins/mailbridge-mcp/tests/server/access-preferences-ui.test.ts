import { runInNewContext } from "node:vm";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ACCESS_PREFERENCES_UI_HTML } from "../../src/server/access-preferences-ui.js";

type Listener = (event: Record<string, unknown>) => unknown;

// Execute the shipped card script against a fake DOM and host bridge. No Mail.app,
// browser profile, user preferences, or network access is involved.
class Element {
  textContent = "";
  className = "";
  disabled = false;
  hidden = false;
  dataset: Record<string, string> = {};
  children: Element[] = [];
  classList = { add: vi.fn(), remove: vi.fn() };
  private listeners = new Map<string, Listener>();
  setAttribute = vi.fn();
  append(...children: Element[]): void { this.children.push(...children); }
  appendChild(child: Element): void { this.append(child); }
  replaceChildren(): void { this.children = []; }
  addEventListener(type: string, listener: Listener): void { this.listeners.set(type, listener); }
  async click(): Promise<void> {
    if (!this.disabled && !this.hidden) await this.listeners.get("click")?.({});
  }
}

interface HostRequest { id: number; method: string; params: unknown }

function harness(openai?: Record<string, unknown>) {
  const elements = new Map<string, Element>();
  for (const match of ACCESS_PREFERENCES_UI_HTML.matchAll(/id="([^"]+)"[^>]*>/g)) {
    const element = new Element();
    element.disabled = match[0].includes("disabled");
    element.hidden = match[0].includes("hidden");
    elements.set(match[1]!, element);
  }
  const listeners = new Map<string, Listener>();
  const requests: HostRequest[] = [];
  const parent = { postMessage: (message: HostRequest) => { requests.push(message); } };
  const window = {
    parent, openai,
    addEventListener: (type: string, listener: Listener) => { listeners.set(type, listener); },
  };
  const document = {
    documentElement: new Element(),
    getElementById: (id: string) => elements.get(id),
    createElement: () => new Element(),
    createElementNS: () => new Element(),
  };
  const script = ACCESS_PREFERENCES_UI_HTML.match(/<script>([\s\S]*?)<\/script>/i)?.[1];
  if (!script) throw new Error("Missing card script");
  runInNewContext(script, { window, document, setTimeout, clearTimeout });
  return {
    requests, document,
    element(id: string): Element { return elements.get(id)!; },
    async message(data: unknown, source: unknown = parent): Promise<void> {
      await listeners.get("message")?.({ data, source });
    },
    async globals(globals: Record<string, unknown>): Promise<void> {
      window.openai = { ...window.openai, ...globals };
      await listeners.get("openai:set_globals")?.({ detail: { globals } });
    },
    async initialize(): Promise<void> {
      const request = requests.find(({ method }) => method === "ui/initialize");
      await this.message({ jsonrpc: "2.0", id: request?.id, result: {
        protocolVersion: "2026-01-26", hostCapabilities: { serverTools: {} }, hostContext: { theme: "dark" },
      } });
      await vi.advanceTimersByTimeAsync(0);
    },
    async proposal(result: unknown = prepared()): Promise<void> {
      await this.message({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: result });
    },
  };
}

function prepared() {
  return {
    structuredContent: { ok: true, data: {
      status: "awaiting-user", proposedMode: "drafts", proposedAllowedAccounts: ["person@example.com"],
      verification: { performed: true, matchedAccounts: ["person@example.com"], unmatchedAccounts: [] },
    } },
    _meta: { "mailbridge/accessProposal": { proposalId: "11111111-1111-4111-8111-111111111111" } },
  };
}

const saved = { structuredContent: { ok: true, data: { saved: true } } };

describe("access card host lifecycle", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("handles delayed OpenAI globals and only saves after the button is clicked", async () => {
    vi.useFakeTimers();
    const callTool = vi.fn().mockResolvedValue(saved);
    const ui = harness({ callTool });
    await ui.globals({ toolOutput: prepared().structuredContent, theme: "dark" });
    expect(ui.element("save").disabled).toBe(true);
    await ui.globals({ toolResponseMetadata: { mcp_tool_result: prepared() } });
    expect(ui.element("save").disabled).toBe(false);
    expect(ui.document.documentElement.dataset.theme).toBe("dark");
    expect(callTool).not.toHaveBeenCalled();
    await ui.element("save").click();
    expect(callTool).toHaveBeenCalledExactlyOnceWith("mailbridge_commit_access_preferences", {
      proposalId: prepared()._meta["mailbridge/accessProposal"].proposalId,
    });
    expect(ui.element("title").textContent).toBe("Access saved");
  });

  it("waits for MCP initialization before enabling Save", async () => {
    vi.useFakeTimers();
    const ui = harness();
    await ui.proposal();
    expect(ui.element("save").disabled).toBe(true);
    await ui.initialize();
    expect(ui.element("save").disabled).toBe(false);
    const click = ui.element("save").click();
    const request = ui.requests.find(({ method }) => method === "tools/call");
    expect(request).toBeDefined();
    await ui.message({ jsonrpc: "2.0", id: request?.id, result: saved });
    await click;
    expect(ui.element("title").textContent).toBe("Access saved");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("recovers from an unanswered save without claiming success or automatically retrying", async () => {
    vi.useFakeTimers();
    const ui = harness();
    await ui.initialize();
    await ui.proposal();
    const click = ui.element("save").click();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(ui.element("fatal").hidden).toBe(false);
    expect(ui.element("save").disabled).toBe(false);
    expect(ui.element("title").textContent).not.toBe("Access saved");
    expect(ui.requests.filter(({ method }) => method === "tools/call")).toHaveLength(1);
    await click;
  });

  it("bounds unanswered OpenAI saves too, and ignores late replies after timeout", async () => {
    vi.useFakeTimers();
    let resolveSave!: (result: unknown) => void;
    const callTool = vi.fn().mockImplementation(() => new Promise((resolve) => { resolveSave = resolve; }));
    const ui = harness({
      toolOutput: prepared().structuredContent, toolResponseMetadata: prepared()._meta, callTool,
    });
    const click = ui.element("save").click();
    await vi.advanceTimersByTimeAsync(30_000);
    await click;
    expect(ui.element("fatal").textContent).toContain("did not confirm the save");
    resolveSave(saved);
    await vi.advanceTimersByTimeAsync(0);
    expect(ui.element("title").textContent).not.toBe("Access saved");
    expect(callTool).toHaveBeenCalledOnce();
    await ui.element("cancel").click();
    expect(ui.element("title").textContent).toBe("Review closed");
    expect(ui.element("status-pill").textContent).not.toBe("Not saved");
  });

  it("reports an unavailable host instead of waiting indefinitely", async () => {
    vi.useFakeTimers();
    const ui = harness();
    await ui.proposal();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(ui.element("save").disabled).toBe(true);
    expect(ui.element("fatal").textContent).toContain("did not connect the access card");
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([{}, { ok: false, error: { message: "Save refused" } }, {
    structuredContent: { ok: true, data: { saved: false } },
  }])("never treats an unconfirmed result as a successful save: %j", async (result) => {
    vi.useFakeTimers();
    const ui = harness({
      toolOutput: prepared().structuredContent,
      toolResponseMetadata: prepared()._meta,
      callTool: vi.fn().mockResolvedValue(result),
    });
    await ui.element("save").click();
    expect(ui.element("title").textContent).not.toBe("Access saved");
    expect(ui.element("fatal").hidden).toBe(false);
  });

  it("ignores duplicate and foreign results during a save or after cancellation", async () => {
    vi.useFakeTimers();
    const ui = harness();
    await ui.initialize();
    await ui.proposal();
    const click = ui.element("save").click();
    await ui.proposal();
    expect(ui.element("save").disabled).toBe(true);
    const request = ui.requests.find(({ method }) => method === "tools/call");
    await ui.message({ jsonrpc: "2.0", id: request?.id, result: saved });
    await click;

    const cancelled = harness();
    await cancelled.initialize();
    await cancelled.message({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: prepared() }, {});
    expect(cancelled.element("save").disabled).toBe(true);
    await cancelled.element("cancel").click();
    await cancelled.proposal();
    expect(cancelled.element("save").disabled).toBe(true);
    expect(cancelled.element("title").textContent).toBe("No changes saved");
  });

  it("binds the review to one proposal so later host updates cannot substitute its fields", async () => {
    vi.useFakeTimers();
    const callTool = vi.fn().mockResolvedValue(saved);
    const ui = harness({ callTool });
    await ui.globals({ toolOutput: prepared().structuredContent, toolResponseMetadata: prepared()._meta });
    await ui.globals({ toolOutput: { ok: true, data: {
      ...prepared().structuredContent.data, proposedMode: "prompted", proposedAllowedAccounts: ["different@example.com"],
    } }, theme: "dark" });
    expect(ui.element("mode-name").textContent).toBe("Read + drafts");
    expect(ui.element("accounts").children.map(({ textContent }) => textContent)).toEqual(["person@example.com"]);
    expect(ui.document.documentElement.dataset.theme).toBe("dark");
    await ui.element("save").click();
    expect(callTool).toHaveBeenCalledExactlyOnceWith("mailbridge_commit_access_preferences", {
      proposalId: prepared()._meta["mailbridge/accessProposal"].proposalId,
    });
  });
});
