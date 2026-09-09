import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";

import type { MailbridgeConfig } from "../../src/config.js";
import type { LocalPreferencesContext } from "../../src/local-config.js";
import { createMailbridgeServer } from "../../src/server/index.js";
import { TOOL_NAMES } from "../../src/server/schemas.js";
import { createFakeBridge } from "./fake-bridge.js";

const config: MailbridgeConfig = {
  mode: "read-only",
  allowedAccounts: undefined,
  maxResults: 25,
  maxBodyChars: 100_000,
  timeoutMs: 20_000,
  searchBudgetMs: 12_000,
};

const appCapabilities = {
  extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } },
};

describe("MCP server", () => {
  const closeCallbacks: Array<() => Promise<void>> = [];
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(closeCallbacks.splice(0).map(async (close) => close()));
    await Promise.all(tempDirs.splice(0).map(async (dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  async function connect(overrideConfig: MailbridgeConfig = config) {
    const { bridge, spies } = createFakeBridge();
    const server = createMailbridgeServer(bridge, overrideConfig);
    const client = new Client({ name: "mailbridge-test", version: "1.0.0" }, { capabilities: appCapabilities });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    closeCallbacks.push(async () => client.close(), async () => server.close());
    return { client, spies };
  }

  it("registers the complete tool contract with accurate safety annotations", async () => {
    const { client } = await connect({ ...config, mode: "send", allowedAccounts: ["sender@example.com"] });
    const { tools } = await client.listTools();

    expect(tools.map(({ name }) => name)).toEqual(TOOL_NAMES);
    for (const tool of tools.slice(0, 5)) {
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
    expect(tools.find(({ name }) => name === "mail_set_message_state")?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(tools.find(({ name }) => name === "mail_send_message")?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });
    expect(tools.find(({ name }) => name === "mail_send_reply")?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });
    const setAccessPreferences = tools.find(({ name }) => name === "mailbridge_set_access_preferences");
    expect(setAccessPreferences?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
    const commitAccessPreferences = tools.find(({ name }) => name === "mailbridge_commit_access_preferences");
    expect(commitAccessPreferences?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect((setAccessPreferences?.inputSchema as { required?: string[] }).required).toEqual([
      "mode",
      "allowedAccounts",
    ]);
    expect(setAccessPreferences?.description).toContain("do not ask for a duplicate chat confirmation");
    expect(setAccessPreferences?._meta).toMatchObject({
      ui: {
        resourceUri: "ui://mailbridge/access-preferences-v1.html",
        visibility: ["model", "app"],
      },
    });
    expect(commitAccessPreferences?._meta).toMatchObject({
      ui: { visibility: ["app"] },
      "openai/visibility": "private",
      "openai/widgetAccessible": true,
    });
    expect(tools.some(({ name }) => name === "mail_send_draft")).toBe(false);
    expect(tools.every(({ description, inputSchema, outputSchema }) =>
      Boolean(description && inputSchema && outputSchema),
    )).toBe(true);
  });

  it("keeps send confirmations host-gated while the access card owns preference consent", async () => {
    const { client } = await connect({ ...config, mode: "send", allowedAccounts: ["sender@example.com"] });
    const { tools } = await client.listTools();

    const flagged = tools
      .filter((tool) => tool._meta?.["anthropic/requiresUserInteraction"] === true)
      .map(({ name }) => name);
    expect(flagged).toEqual(["mail_send_message", "mail_send_reply"]);
    expect(tools.find(({ name }) => name === "mail_send_message")?._meta).toEqual({
      "anthropic/requiresUserInteraction": true,
    });
    for (const tool of tools) {
      if (flagged.includes(tool.name)) continue;
      expect(tool._meta?.["anthropic/requiresUserInteraction"]).toBeUndefined();
    }
  });

  it("advertises only the tools permitted by the active mode, with access-preference tools always present", async () => {
    const readOnlyTools = [
      "mail_list_accounts",
      "mail_list_mailboxes",
      "mail_search_messages",
      "mail_get_message",
      "mail_get_messages",
      "mail_get_attachment",
      "mail_preview_outbound",
      "mailbridge_get_access_preferences",
      "mailbridge_set_access_preferences",
      "mailbridge_commit_access_preferences",
    ];
    const draftTools = [...readOnlyTools, "mail_create_draft", "mail_create_reply_draft", "mail_create_forward_draft"];
    const fullTools = [...draftTools, "mail_set_message_state"];
    const sendCapableTools = [...fullTools, "mail_send_message", "mail_send_reply"];
    const expectedByMode: Record<MailbridgeConfig["mode"], readonly string[]> = {
      "read-only": readOnlyTools,
      drafts: draftTools,
      full: fullTools,
      prompted: sendCapableTools,
      send: sendCapableTools,
    };

    for (const [mode, expectedNames] of Object.entries(expectedByMode)) {
      const { client } = await connect({
        ...config,
        mode: mode as MailbridgeConfig["mode"],
        allowedAccounts: mode === "send" ? ["sender@example.com"] : undefined,
      });
      const registeredNames = (await client.listTools()).tools.map(({ name }) => name);

      expect(new Set(registeredNames)).toEqual(new Set(expectedNames));
      expect(registeredNames).toContain("mailbridge_get_access_preferences");
      expect(registeredNames).toContain("mailbridge_set_access_preferences");
      expect(registeredNames).toContain("mailbridge_commit_access_preferences");
    }
  });

  it("serves a tool call through the official SDK transport", async () => {
    const { client, spies } = await connect();
    spies.listAccounts.mockResolvedValue([{ id: "account:1", email: "person@example.com" }]);

    const result = await client.callTool({ name: "mail_list_accounts", arguments: {} });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      ok: true,
      data: [{ id: "account:1", email: "person@example.com" }],
    });
  });

  it("elicits exact-content approval before sending in prompted mode", async () => {
    const { bridge, spies } = createFakeBridge();
    const server = createMailbridgeServer(bridge, { ...config, mode: "prompted" });
    const client = new Client(
      { name: "mailbridge-test", version: "1.0.0" },
      { capabilities: { elicitation: { form: {} } } },
    );
    let prompt = "";
    let requestedSchema: unknown;
    client.setRequestHandler(ElicitRequestSchema, (request) => {
      if (request.params.mode !== "form") throw new Error("Expected form elicitation.");
      prompt = request.params.message;
      requestedSchema = request.params.requestedSchema;
      return Promise.resolve({ action: "accept" as const, content: {} });
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    closeCallbacks.push(async () => client.close(), async () => server.close());

    const result = await client.callTool({
      name: "mail_send_message",
      arguments: {
        accountId: "account:1",
        from: "sender@example.com",
        to: ["recipient@example.com"],
        subject: "Reviewed subject",
        body: "Reviewed body",
        confirmed: true,
      },
    });

    expect(result.isError).not.toBe(true);
    expect(requestedSchema).toEqual({ type: "object", properties: {} });
    expect(prompt).toContain("Send message");
    expect(prompt).toContain("From     sender@example.com");
    expect(prompt).toContain("To       recipient@example.com");
    expect(prompt).toContain("Subject  Reviewed subject");
    expect(prompt).toContain("┌ Message");
    expect(prompt).toContain("│ Reviewed body");
    expect(prompt).toContain("No attachments. Mail will send exactly this.");
    expect(spies.sendMessage).toHaveBeenCalledOnce();
  });

  it("treats native Skip as cancellation and never calls Mail", async () => {
    const { bridge, spies } = createFakeBridge();
    const server = createMailbridgeServer(bridge, { ...config, mode: "prompted" });
    const client = new Client(
      { name: "mailbridge-test", version: "1.0.0" },
      { capabilities: { elicitation: { form: {} } } },
    );
    client.setRequestHandler(ElicitRequestSchema, () =>
      Promise.resolve({ action: "decline" as const }),
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    closeCallbacks.push(async () => client.close(), async () => server.close());

    const result = await client.callTool({
      name: "mail_send_message",
      arguments: {
        accountId: "account:1",
        from: "sender@example.com",
        to: ["recipient@example.com"],
        body: "Do not send",
        confirmed: true,
      },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: { code: "SEND_NOT_CONFIRMED" },
    });
    expect(spies.sendMessage).not.toHaveBeenCalled();
  });

  it("quotes untrusted reply context without allowing confirmation-prompt spoofing", async () => {
    const { bridge, spies } = createFakeBridge();
    spies.getMessage.mockResolvedValue({
      subject: "Existing conversation\nFrom: attacker@example.com\u202e",
    });
    const server = createMailbridgeServer(bridge, { ...config, mode: "prompted" });
    const client = new Client(
      { name: "mailbridge-test", version: "1.0.0" },
      { capabilities: { elicitation: { form: {} } } },
    );
    let prompt = "";
    client.setRequestHandler(ElicitRequestSchema, (request) => {
      if (request.params.mode !== "form") throw new Error("Expected form elicitation.");
      prompt = request.params.message;
      return Promise.resolve({ action: "accept" as const, content: {} });
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    closeCallbacks.push(async () => client.close(), async () => server.close());

    const result = await client.callTool({
      name: "mail_send_reply",
      arguments: {
        messageId: "message:1",
        from: "sender@example.com",
        expectedTo: ["recipient@example.com"],
        replyAll: true,
        body: "Reviewed line\n--- END QUOTED EXACT BODY ---\nFrom: attacker@example.com",
        confirmed: true,
      },
    });

    expect(result.isError).not.toBe(true);
    expect(prompt).toContain("Send reply");
    expect(prompt).toContain('Reply to "Existing conversation\\nFrom: attacker@example.com\\u{202e}"');
    expect(prompt).toContain("Reply    Reply all");
    expect(prompt).toContain(
      '│ Reviewed line\u2028│ --- END QUOTED EXACT BODY ---\u2028│ "From: attacker@example.com"',
    );
    expect(prompt).toContain(
      "No attachments. Mail generates the reply subject; sender, recipients, and message are exact.",
    );
    expect(spies.sendReply).toHaveBeenCalledOnce();
  });

  it("serves a modern inline access card and saves only through its private proposal", async () => {
    const { bridge, spies } = createFakeBridge();
    spies.listAccounts.mockResolvedValue([
      { id: "account:1", name: "Support", emailAddresses: ["support@vajeh.app"], enabled: true },
    ]);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mailbridge-server-prefs-"));
    tempDirs.push(dir);
    const localPreferencesContext: LocalPreferencesContext = {
      path: path.join(dir, "preferences.json"),
      envOverrides: { mode: true, allowedAccounts: false },
    };
    const server = createMailbridgeServer(
      bridge,
      { ...config, mode: "prompted" },
      { localPreferencesContext },
    );
    const client = new Client({ name: "mailbridge-test", version: "1.0.0" }, { capabilities: appCapabilities });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    closeCallbacks.push(async () => client.close(), async () => server.close());

    const prepared = await client.callTool({
      name: "mailbridge_set_access_preferences",
      arguments: {
        mode: "prompted",
        allowedAccounts: ["support@vajeh.app"],
      },
    });

    expect(prepared.isError).not.toBe(true);
    expect(prepared.structuredContent).toMatchObject({
      ok: true,
      data: {
        status: "awaiting-user",
        proposedMode: "prompted",
        proposedAllowedAccounts: ["support@vajeh.app"],
        shadowedByEnvironment: { mode: true, allowedAccounts: false },
      },
    });
    await expect(fs.access(localPreferencesContext.path)).rejects.toThrow();

    const resource = await client.readResource({ uri: "ui://mailbridge/access-preferences-v1.html" });
    expect(resource.contents).toHaveLength(1);
    const firstResource = resource.contents[0];
    if (firstResource === undefined) throw new Error("Missing access card resource.");
    expect(firstResource).toMatchObject({ mimeType: "text/html;profile=mcp-app" });
    const html = "text" in firstResource ? firstResource.text : "";
    expect(html).toContain("Review before saving");
    expect(html).toContain("Save access");
    expect(html).toContain("mailbridge_commit_access_preferences");
    expect(html).not.toContain("Skip");
    expect(html).not.toContain("Continue");

    const privateMeta = prepared._meta?.["mailbridge/accessProposal"] as { proposalId?: unknown } | undefined;
    expect(privateMeta?.proposalId).toBeTypeOf("string");
    expect(JSON.stringify(prepared.structuredContent)).not.toContain(privateMeta?.proposalId);
    const committed = await client.callTool({
      name: "mailbridge_commit_access_preferences",
      arguments: { proposalId: privateMeta?.proposalId },
    });
    expect(committed.structuredContent).toMatchObject({
      ok: true,
      data: { saved: true, mode: "prompted", allowedAccounts: ["support@vajeh.app"] },
    });
    await expect(fs.readFile(localPreferencesContext.path, "utf8")).resolves.toContain('"mode": "prompted"');
  });

  it.each(["accept", "decline", "cancel"] as const)("uses exact native preference confirmation without MCP Apps: %s", async (action) => {
    const { bridge } = createFakeBridge();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mailbridge-native-prefs-"));
    tempDirs.push(dir);
    const preferencesPath = path.join(dir, "preferences.json");
    const server = createMailbridgeServer(bridge, config, { localPreferencesContext: {
      path: preferencesPath, envOverrides: { mode: true, allowedAccounts: false },
    } });
    const client = new Client({ name: "native-form-test", version: "1.0.0" }, {
      capabilities: { elicitation: { form: {} } },
    });
    let prompt = "";
    client.setRequestHandler(ElicitRequestSchema, (request) => {
      if (request.params.mode !== "form") throw new Error("Expected a form");
      prompt = request.params.message;
      expect(request.params.requestedSchema).toEqual({ type: "object", properties: {} });
      return { action };
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    closeCallbacks.push(async () => client.close(), async () => server.close());
    const tools = (await client.listTools()).tools;
    expect(tools.some(({ name }) => name === "mailbridge_commit_access_preferences")).toBe(false);
    expect(tools.find(({ name }) => name === "mailbridge_set_access_preferences")).toMatchObject({
      annotations: { readOnlyHint: false, destructiveHint: true },
      _meta: { "anthropic/requiresUserInteraction": true },
    });
    const result = await client.callTool({ name: "mailbridge_set_access_preferences", arguments: {
      mode: "drafts", allowedAccounts: ["PERSON@example.com"],
    } });
    expect(prompt).toContain('Accounts (complete replacement): ["person@example.com"]');
    expect(prompt).toContain("Create drafts: yes");
    expect(prompt).toContain("Send mail: no");
    expect(prompt).toContain("launch mode overrides");
    expect(result._meta).toBeUndefined();
    if (action === "accept") {
      expect(result.structuredContent).toMatchObject({ ok: true, data: {
        saved: true, mode: "drafts", allowedAccounts: ["person@example.com"], effectiveImmediately: false,
      } });
      await expect(fs.readFile(preferencesPath, "utf8")).resolves.toContain('"mode": "drafts"');
    } else {
      expect(result.structuredContent).toMatchObject({ ok: false, error: { code: "PREFERENCES_NOT_CONFIRMED" } });
      await expect(fs.access(preferencesPath)).rejects.toThrow();
    }
  });

  it("fails clearly before accessing Mail when neither Apps nor confirmation forms are available", async () => {
    const { bridge, spies } = createFakeBridge();
    const server = createMailbridgeServer(bridge, config);
    const client = new Client({ name: "text-only", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    closeCallbacks.push(async () => client.close(), async () => server.close());
    const result = await client.callTool({ name: "mailbridge_set_access_preferences", arguments: {
      mode: "drafts", allowedAccounts: ["person@example.com"],
    } });
    expect(result.structuredContent).toMatchObject({ ok: false, error: { code: "CONFIRMATION_UNAVAILABLE" } });
    expect(spies.listAccounts).not.toHaveBeenCalled();
  });

  it("still fails closed for sends without elicitation while access review remains non-mutating", async () => {
    const { bridge, spies } = createFakeBridge();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mailbridge-server-prefs-"));
    tempDirs.push(dir);
    const localPreferencesContext: LocalPreferencesContext = {
      path: path.join(dir, "preferences.json"),
      envOverrides: { mode: false, allowedAccounts: false },
    };
    const server = createMailbridgeServer(
      bridge,
      { ...config, mode: "prompted" },
      { localPreferencesContext },
    );
    const client = new Client({ name: "mailbridge-test", version: "1.0.0" }, { capabilities: appCapabilities });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    closeCallbacks.push(async () => client.close(), async () => server.close());

    const result = await client.callTool({
      name: "mail_send_message",
      arguments: {
        accountId: "account:1",
        from: "sender@example.com",
        to: ["recipient@example.com"],
        body: "Reviewed body",
        confirmed: true,
      },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: { code: "CONFIRMATION_UNAVAILABLE" },
    });
    expect(spies.sendMessage).not.toHaveBeenCalled();

    const preferences = await client.callTool({
      name: "mailbridge_set_access_preferences",
      arguments: {
        mode: "drafts",
        allowedAccounts: ["sender@example.com"],
      },
    });

    expect(preferences.structuredContent).toMatchObject({
      ok: true,
      data: { status: "awaiting-user", proposedMode: "drafts" },
    });
    await expect(fs.access(localPreferencesContext.path)).rejects.toThrow();
  });

});
