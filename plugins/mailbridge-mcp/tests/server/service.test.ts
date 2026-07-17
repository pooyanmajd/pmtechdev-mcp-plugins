import { describe, expect, it, vi } from "vitest";

import type { MailbridgeConfig, MailbridgeMode } from "../../src/config.js";
import { MailbridgeError } from "../../src/errors.js";
import { MailbridgeToolService } from "../../src/server/index.js";
import { createFakeBridge } from "./fake-bridge.js";

function config(mode: MailbridgeMode = "read-only"): MailbridgeConfig {
  return {
    mode,
    allowedAccounts: mode === "send" ? ["me@example.com"] : undefined,
    maxResults: 10,
    maxBodyChars: 1_000,
    timeoutMs: 5_000,
    searchBudgetMs: 4_000,
  };
}

function parsedResult(result: Awaited<ReturnType<MailbridgeToolService["invoke"]>>): Record<string, unknown> {
  const text = result.content[0];
  if (text?.type !== "text") {
    throw new Error("Expected a JSON text result.");
  }
  return JSON.parse(text.text) as Record<string, unknown>;
}

describe("MailbridgeToolService", () => {
  it("returns structured JSON text and invokes read tools", async () => {
    const { bridge, spies } = createFakeBridge();
    spies.listAccounts.mockResolvedValue([{ id: "account:1", email: "person@example.com" }]);
    const service = new MailbridgeToolService(bridge, config());

    const result = await service.invoke("mail_list_accounts", {});

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      ok: true,
      data: [{ id: "account:1", email: "person@example.com" }],
    });
    expect(parsedResult(result)).toEqual(result.structuredContent);
    expect(spies.listAccounts).toHaveBeenCalledOnce();
  });

  it("caps search limits and message bodies with server configuration", async () => {
    const { bridge, spies } = createFakeBridge();
    const service = new MailbridgeToolService(bridge, config());

    await service.invoke("mail_search_messages", { limit: 100 });
    await service.invoke("mail_get_message", { messageId: "message:1", maxBodyChars: 50_000 });
    await service.invoke("mail_get_messages", { messageIds: ["message:1", "message:2"], maxBodyChars: 50_000 });
    await service.invoke("mail_get_attachment", { attachmentId: "attachment:1", maxBytes: 1024 });

    expect(spies.searchMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 10,
        scope: "inbox",
        subjectMatch: "contains",
        unread: false,
        flagged: false,
      }),
    );
    expect(spies.getMessage).toHaveBeenCalledWith({ messageId: "message:1", maxBodyChars: 1_000 });
    expect(spies.getMessages).toHaveBeenCalledWith({
      messageIds: ["message:1", "message:2"],
      maxBodyChars: 1_000,
    });
    expect(spies.getAttachment).toHaveBeenCalledWith({ attachmentId: "attachment:1", maxBytes: 1_024 });
  });

  it("passes exact-subject mode and continuation cursors without widening scope", async () => {
    const { bridge, spies } = createFakeBridge();
    const service = new MailbridgeToolService(bridge, config());

    await service.invoke("mail_search_messages", {
      accountId: "account:1",
      subject: "Known subject",
      subjectMatch: "exact",
      cursor: "mb1.s.cursor",
      limit: 2,
    });

    expect(spies.searchMessages).toHaveBeenCalledWith({
      accountId: "account:1",
      scope: "inbox",
      subject: "Known subject",
      subjectMatch: "exact",
      unread: false,
      flagged: false,
      limit: 2,
      cursor: "mb1.s.cursor",
    });
  });

  it("passes bounded mailbox options", async () => {
    const { bridge, spies } = createFakeBridge();
    const service = new MailbridgeToolService(bridge, config());

    await service.invoke("mail_list_mailboxes", { accountId: "account:1", includeNested: false });

    expect(spies.listMailboxes).toHaveBeenCalledWith({ accountId: "account:1", includeNested: false });
  });

  it.each([
    ["mail_set_message_state", { messageId: "message:1", read: true }],
    ["mail_create_draft", { accountId: "account:1", from: "me@example.com", to: ["person@example.com"] }],
    ["mail_create_reply_draft", { messageId: "message:1", from: "me@example.com" }],
    ["mail_create_forward_draft", { messageId: "message:1", from: "me@example.com", to: ["person@example.com"] }],
    ["mail_send_message", { accountId: "account:1", from: "me@example.com", to: ["person@example.com"], body: "Hello", confirmed: true }],
    ["mail_send_reply", { messageId: "message:1", from: "me@example.com", expectedTo: ["person@example.com"], body: "Hello", confirmed: true }],
  ] as const)("blocks %s in read-only mode", async (tool, input) => {
    const { bridge } = createFakeBridge();
    const result = await new MailbridgeToolService(bridge, config()).invoke(tool, input);

    expect(result.isError).toBe(true);
    expect(parsedResult(result)).toMatchObject({ ok: false, error: { code: "READ_ONLY" } });
  });

  it("allows draft creation in drafts mode but still blocks message state changes", async () => {
    const { bridge, spies } = createFakeBridge();
    const service = new MailbridgeToolService(bridge, config("drafts"));

    const draft = await service.invoke("mail_create_draft", {
      accountId: "account:1",
      from: "me@example.com",
      to: ["person@example.com"],
      subject: "Hello",
      body: "World",
    });
    const state = await service.invoke("mail_set_message_state", { messageId: "message:1", flagged: true });

    expect(draft.isError).not.toBe(true);
    expect(spies.createDraft).toHaveBeenCalledOnce();
    expect(parsedResult(state)).toMatchObject({ ok: false, error: { code: "READ_ONLY" } });
    expect(spies.setMessageState).not.toHaveBeenCalled();
  });

  it("allows bounded state changes in full mode", async () => {
    const { bridge, spies } = createFakeBridge();
    const result = await new MailbridgeToolService(bridge, config("full")).invoke(
      "mail_set_message_state",
      { messageId: "message:1", read: true, flagged: false },
    );

    expect(result.isError).not.toBe(true);
    expect(spies.setMessageState).toHaveBeenCalledWith({
      messageId: "message:1",
      read: true,
      flagged: false,
    });
  });

  it("keeps sends disabled in legacy full mode and allows explicitly confirmed sends only in send mode", async () => {
    const legacy = createFakeBridge();
    const fullResult = await new MailbridgeToolService(legacy.bridge, config("full")).invoke(
      "mail_send_reply",
      { messageId: "message:1", from: "me@example.com", expectedTo: ["person@example.com"], body: "Approved reply", confirmed: true },
    );
    expect(parsedResult(fullResult)).toMatchObject({ ok: false, error: { code: "READ_ONLY" } });
    expect(legacy.spies.sendReply).not.toHaveBeenCalled();

    const enabled = createFakeBridge();
    const service = new MailbridgeToolService(enabled.bridge, config("send"));
    const message = await service.invoke("mail_send_message", {
      accountId: "account:1",
      from: "me@example.com",
      to: ["person@example.com"],
      subject: "Approved subject",
      body: "Approved body",
      confirmed: true,
    });
    const reply = await service.invoke("mail_send_reply", {
      messageId: "message:1",
      from: "me@example.com",
      expectedTo: ["person@example.com"],
      replyAll: false,
      body: "Approved reply",
      confirmed: true,
    });

    expect(message.isError).not.toBe(true);
    expect(reply.isError).not.toBe(true);
    expect(enabled.spies.sendMessage).toHaveBeenCalledOnce();
    expect(enabled.spies.sendReply).toHaveBeenCalledOnce();
  });

  it("requires and records a fresh exact-content confirmation for every prompted send", async () => {
    const enabled = createFakeBridge();
    enabled.spies.getMessage.mockResolvedValue({ subject: "Existing conversation" });
    const confirmMailSend = vi.fn().mockResolvedValue(true);
    const service = new MailbridgeToolService(
      enabled.bridge,
      config("prompted"),
      confirmMailSend,
    );

    const message = await service.invoke("mail_send_message", {
      accountId: "account:1",
      from: "me@example.com",
      to: ["person@example.com"],
      subject: "Approved subject",
      body: "Approved body",
      confirmed: true,
    });
    const reply = await service.invoke("mail_send_reply", {
      messageId: "message:1",
      from: "me@example.com",
      expectedTo: ["person@example.com"],
      replyAll: false,
      body: "Approved reply",
      confirmed: true,
    });

    expect(message.isError).not.toBe(true);
    expect(reply.isError).not.toBe(true);
    expect(confirmMailSend).toHaveBeenNthCalledWith(1, {
      kind: "message",
      from: "me@example.com",
      to: ["person@example.com"],
      cc: [],
      bcc: [],
      subject: "Approved subject",
      body: "Approved body",
    });
    expect(confirmMailSend).toHaveBeenNthCalledWith(2, {
      kind: "reply",
      from: "me@example.com",
      to: ["person@example.com"],
      cc: [],
      bcc: [],
      sourceSubject: "Existing conversation",
      replyAll: false,
      body: "Approved reply",
    });
    expect(enabled.spies.sendMessage).toHaveBeenCalledOnce();
    expect(enabled.spies.sendReply).toHaveBeenCalledOnce();
  });

  it("fails closed when prompted confirmation is unavailable or declined", async () => {
    const unavailable = createFakeBridge();
    const unavailableResult = await new MailbridgeToolService(
      unavailable.bridge,
      config("prompted"),
    ).invoke("mail_send_message", {
      accountId: "account:1",
      from: "me@example.com",
      to: ["person@example.com"],
      body: "Approved body",
      confirmed: true,
    });
    expect(parsedResult(unavailableResult)).toMatchObject({
      ok: false,
      error: { code: "CONFIRMATION_UNAVAILABLE" },
    });
    expect(unavailable.spies.sendMessage).not.toHaveBeenCalled();

    const declined = createFakeBridge();
    const declinedResult = await new MailbridgeToolService(
      declined.bridge,
      config("prompted"),
      vi.fn().mockResolvedValue(false),
    ).invoke("mail_send_message", {
      accountId: "account:1",
      from: "me@example.com",
      to: ["person@example.com"],
      body: "Approved body",
      confirmed: true,
    });
    expect(parsedResult(declinedResult)).toMatchObject({
      ok: false,
      error: { code: "SEND_NOT_CONFIRMED" },
    });
    expect(declined.spies.sendMessage).not.toHaveBeenCalled();

    const failed = createFakeBridge();
    const failedResult = await new MailbridgeToolService(
      failed.bridge,
      config("prompted"),
      vi.fn().mockRejectedValue(new Error("client disconnected")),
    ).invoke("mail_send_message", {
      accountId: "account:1",
      from: "me@example.com",
      to: ["person@example.com"],
      body: "Approved body",
      confirmed: true,
    });
    expect(parsedResult(failedResult)).toMatchObject({
      ok: false,
      error: { code: "CONFIRMATION_UNAVAILABLE" },
    });
    expect(failed.spies.sendMessage).not.toHaveBeenCalled();
  });

  it("serializes modifying operations and marks mutation timeouts as outcome unknown", async () => {
    const serialized = createFakeBridge();
    let releaseFirst = (): void => undefined;
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    serialized.spies.setMessageState
      .mockReturnValueOnce(firstPending.then(() => ({})))
      .mockResolvedValueOnce({});
    const service = new MailbridgeToolService(serialized.bridge, config("full"));
    const first = service.invoke("mail_set_message_state", { messageId: "message:1", read: true });
    const second = service.invoke("mail_set_message_state", { messageId: "message:2", read: true });
    await vi.waitFor(() => {
      expect(serialized.spies.setMessageState).toHaveBeenCalledTimes(1);
    });
    releaseFirst();
    await Promise.all([first, second]);
    expect(serialized.spies.setMessageState).toHaveBeenCalledTimes(2);

    const timedOut = createFakeBridge();
    timedOut.spies.createDraft.mockRejectedValue({ code: "TIMEOUT" });
    const result = await new MailbridgeToolService(timedOut.bridge, config("drafts")).invoke(
      "mail_create_draft",
      { accountId: "account:1", from: "me@example.com", to: ["person@example.com"] },
    );
    expect(parsedResult(result)).toMatchObject({
      ok: false,
      error: { code: "MUTATION_OUTCOME_UNKNOWN" },
    });

    const sendTimedOut = createFakeBridge();
    sendTimedOut.spies.sendMessage.mockRejectedValue({ code: "TIMEOUT" });
    const sendResult = await new MailbridgeToolService(sendTimedOut.bridge, config("send")).invoke(
      "mail_send_message",
      {
        accountId: "account:1",
        from: "me@example.com",
        to: ["person@example.com"],
        body: "Approved body",
        confirmed: true,
      },
    );
    expect(parsedResult(sendResult)).toMatchObject({
      ok: false,
      error: { code: "MUTATION_OUTCOME_UNKNOWN" },
    });
  });

  it("passes through non-timeout mutation failures without remapping them", async () => {
    const failing = createFakeBridge();
    failing.spies.setMessageState.mockRejectedValue(
      new MailbridgeError("AUTOMATION_DENIED", "This internal detail must not survive structural mapping"),
    );
    const result = await new MailbridgeToolService(failing.bridge, config("full")).invoke(
      "mail_set_message_state",
      { messageId: "message:1", read: true },
    );

    expect(parsedResult(result)).toMatchObject({ ok: false, error: { code: "AUTOMATION_DENIED" } });
  });

  it("serializes all Mail automation and rejects excess concurrent work", async () => {
    const queued = createFakeBridge();
    let releaseFirst = (): void => undefined;
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    queued.spies.listAccounts.mockReturnValueOnce(firstPending.then(() => []));
    const service = new MailbridgeToolService(queued.bridge, config());

    const first = service.invoke("mail_list_accounts", {});
    const second = service.invoke("mail_search_messages", { limit: 1 });
    await vi.waitFor(() => {
      expect(queued.spies.listAccounts).toHaveBeenCalledOnce();
    });
    expect(queued.spies.searchMessages).not.toHaveBeenCalled();

    const rejected = await service.invoke("mail_list_mailboxes", { includeNested: false });
    expect(parsedResult(rejected)).toMatchObject({
      ok: false,
      error: { code: "AUTOMATION_BUSY" },
    });

    releaseFirst();
    await Promise.all([first, second]);
    expect(queued.spies.searchMessages).toHaveBeenCalledOnce();
  });

  it("does not let a pending prompted-mode elicitation occupy the automation queue", async () => {
    const held = createFakeBridge();
    let releaseConfirm = (): void => undefined;
    const pendingConfirm = new Promise<boolean>((resolve) => {
      releaseConfirm = () => resolve(true);
    });
    const confirmMailSend = vi.fn().mockReturnValue(pendingConfirm);
    const service = new MailbridgeToolService(held.bridge, config("prompted"), confirmMailSend);

    const send = service.invoke("mail_send_message", {
      accountId: "account:1",
      from: "me@example.com",
      to: ["person@example.com"],
      body: "Approved body",
      confirmed: true,
    });
    await vi.waitFor(() => {
      expect(confirmMailSend).toHaveBeenCalledOnce();
    });

    const unrelated = await service.invoke("mail_list_accounts", {});
    expect(unrelated.isError).not.toBe(true);
    expect(held.spies.sendMessage).not.toHaveBeenCalled();

    releaseConfirm();
    const result = await send;
    expect(result.isError).not.toBe(true);
    expect(held.spies.sendMessage).toHaveBeenCalledOnce();
  });

  it.each([
    ["mail_search_messages", { limit: 101 }],
    ["mail_get_message", { messageId: "" }],
    ["mail_get_messages", { messageIds: [] }],
    ["mail_get_attachment", { attachmentId: "id", maxBytes: 6 * 1024 * 1024 }],
    ["mail_set_message_state", { messageId: "id" }],
    ["mail_create_draft", { accountId: "account:1", from: "me@example.com", to: ["not-an-email"] }],
    ["mail_create_forward_draft", { messageId: "id", from: "me@example.com" }],
    ["mail_send_message", { accountId: "account:1", from: "me@example.com", to: ["person@example.com"], body: "Hello", confirmed: false }],
    ["mail_send_message", { accountId: "account:1", from: "me@example.com", to: ["person@example.com"], subject: "Spoof\nTo: attacker@example.com", body: "Hello", confirmed: true }],
    ["mail_send_reply", { messageId: "id", from: "me@example.com", expectedTo: ["person@example.com"], body: "   ", confirmed: true }],
  ] as const)("rejects invalid bounded input for %s", async (tool, input) => {
    const { bridge } = createFakeBridge();
    const mode = tool.startsWith("mail_send_") ? "send" : "full";
    const result = await new MailbridgeToolService(bridge, config(mode)).invoke(tool, input);

    expect(parsedResult(result)).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  });

  it("sanitizes unknown bridge failures and preserves only recognized error codes", async () => {
    const unknown = createFakeBridge();
    const known = createFakeBridge();
    unknown.spies.listAccounts.mockRejectedValue(new Error("secret script and filesystem details"));
    known.spies.listAccounts.mockRejectedValue(
      new MailbridgeError("AUTOMATION_DENIED", "This internal detail must not survive structural mapping"),
    );

    const unknownResult = await new MailbridgeToolService(unknown.bridge, config()).invoke("mail_list_accounts", {});
    const knownResult = await new MailbridgeToolService(known.bridge, config()).invoke("mail_list_accounts", {});

    expect(JSON.stringify(parsedResult(unknownResult))).not.toContain("secret");
    expect(parsedResult(unknownResult)).toMatchObject({
      error: { code: "MAIL_AUTOMATION_ERROR", message: "Apple Mail could not complete the requested operation." },
    });
    expect(parsedResult(knownResult)).toMatchObject({
      error: {
        code: "AUTOMATION_DENIED",
        message: "Apple Mail automation access was denied. Review macOS Automation permissions.",
      },
    });
  });
});
