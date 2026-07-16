import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";

import type { MailbridgeConfig } from "../../src/config.js";
import { createMailbridgeServer } from "../../src/server/index.js";
import { TOOL_NAMES } from "../../src/server/schemas.js";
import { createFakeBridge } from "./fake-bridge.js";

const config: MailbridgeConfig = {
  mode: "read-only",
  allowedAccounts: undefined,
  maxResults: 25,
  maxBodyChars: 100_000,
  timeoutMs: 20_000,
};

describe("MCP server", () => {
  const closeCallbacks: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(closeCallbacks.splice(0).map(async (close) => close()));
  });

  async function connect() {
    const { bridge, spies } = createFakeBridge();
    const server = createMailbridgeServer(bridge, config);
    const client = new Client({ name: "mailbridge-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    closeCallbacks.push(async () => client.close(), async () => server.close());
    return { client, spies };
  }

  it("registers the complete tool contract with accurate safety annotations", async () => {
    const { client } = await connect();
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
    expect(tools.some(({ name }) => name === "mail_send_draft")).toBe(false);
    expect(tools.every(({ description, inputSchema, outputSchema }) =>
      Boolean(description && inputSchema && outputSchema),
    )).toBe(true);
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

});
