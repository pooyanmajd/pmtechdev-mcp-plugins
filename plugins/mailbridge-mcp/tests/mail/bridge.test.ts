import { describe, expect, it, vi } from "vitest";

import {
  AppleMailBridge,
  MailBridgeError,
  decodeMailId,
  encodeMailId,
  type AutomationRequest,
  type AutomationRunner,
} from "../../src/mail/bridge.js";

class FakeRunner implements AutomationRunner {
  readonly requests: AutomationRequest[] = [];
  readonly runMock = vi.fn();
  private readonly responses: unknown[] = [];

  enqueue(response: unknown): void {
    this.responses.push(response);
  }

  run<T>(request: AutomationRequest): Promise<T> {
    this.requests.push(request);
    this.runMock(request);
    return Promise.resolve(this.responses.shift() as T);
  }
}

function makeBridge(
  runner: AutomationRunner,
  allowedAccounts: string[] = [],
  promptedSend = false,
): AppleMailBridge {
  return new AppleMailBridge({
    allowedAccounts,
    promptedSend,
    maxBodyChars: 1_000,
    maxAttachmentBytes: 1_024,
    maxResults: 50,
    timeoutMs: 100,
    runner,
  });
}

const ACCOUNT_LOCATOR = { accountKey: "account-1" };
const MAILBOX_LOCATOR = { accountKey: "account-1", path: ["Inbox", "Project"] };
const MESSAGE_LOCATOR = { ...MAILBOX_LOCATOR, messageKey: "message-7" };

describe("AppleMailBridge", () => {
  it("filters account results and passes the allowlist to every automation request", async () => {
    const runner = new FakeRunner();
    runner.enqueue([
      {
        accountKey: "account-1",
        name: "Personal",
        emailAddresses: ["allowed@example.com"],
        enabled: true,
      },
      {
        accountKey: "account-2",
        name: "Other",
        emailAddresses: ["other@example.com"],
        enabled: true,
      },
    ]);
    const bridge = makeBridge(runner, ["ALLOWED@example.com"]);

    const accounts = await bridge.listAccounts();

    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.emailAddresses).toEqual(["allowed@example.com"]);
    expect(runner.requests[0]?.policy.allowedAccounts).toEqual(["allowed@example.com"]);
    expect(runner.requests[0]?.policy.promptedSend).toBe(false);
    expect(runner.requests[0]?.policy.searchTimeBudgetMs).toBe(80);
  });

  it("decodes public selectors before dispatch and maps raw nested message identities", async () => {
    const runner = new FakeRunner();
    runner.enqueue({
      messages: [{
        ...MESSAGE_LOCATOR,
        rfcMessageId: "rfc@example.com",
        subject: "Status",
        sender: "sender@example.com",
        dateReceived: "2026-01-01T00:00:00.000Z",
        read: false,
        flagged: true,
        sizeBytes: 99,
      }],
      scannedCount: 12,
      incomplete: false,
      stopReasons: [],
      coverage: { mailboxesSelected: 1, mailboxesCompleted: 1, strategy: "indexed" },
    });
    const bridge = makeBridge(runner);

    const result = await bridge.searchMessages({
      accountId: encodeMailId("account", ACCOUNT_LOCATOR),
      mailboxId: encodeMailId("mailbox", MAILBOX_LOCATOR),
      unread: true,
      limit: 10,
    });

    expect(runner.requests[0]?.input).toMatchObject({
      account: ACCOUNT_LOCATOR,
      mailbox: MAILBOX_LOCATOR,
      scope: "inbox",
      unread: true,
      limit: 10,
    });
    expect(result).toMatchObject({
      scannedCount: 12,
      incomplete: false,
      stopReasons: [],
      coverage: { mailboxesSelected: 1, mailboxesCompleted: 1, strategy: "indexed" },
    });
    expect(decodeMailId("message", result.messages[0]!.id)).toEqual(MESSAGE_LOCATOR);
    expect(decodeMailId("mailbox", result.messages[0]!.mailboxId)).toEqual(MAILBOX_LOCATOR);
  });

  it("encodes resumable progress and binds cursors to unchanged search filters", async () => {
    const runner = new FakeRunner();
    runner.enqueue({
      messages: [],
      scannedCount: 3,
      incomplete: true,
      nextCursor: {
        scans: [{
          accountKey: "account-1",
          path: ["Inbox", "Project"],
          index: 3,
          native: false,
          done: false,
          anchorMessageKey: "message-3",
        }],
      },
      stopReasons: ["time_budget"],
      coverage: { mailboxesSelected: 1, mailboxesCompleted: 0, strategy: "indexed" },
    });
    runner.enqueue({
      messages: [],
      scannedCount: 2,
      incomplete: false,
      stopReasons: [],
      coverage: { mailboxesSelected: 1, mailboxesCompleted: 1, strategy: "indexed" },
    });
    const bridge = makeBridge(runner);
    const mailboxId = encodeMailId("mailbox", MAILBOX_LOCATOR);

    const first = await bridge.searchMessages({
      mailboxId,
      subject: "Statement — July",
      subjectMatch: "exact",
      limit: 5,
    });
    expect(first.nextCursor).toMatch(/^mb1\.s\./);
    if (!first.nextCursor) throw new Error("Expected a continuation cursor.");
    await bridge.searchMessages({
      mailboxId,
      subject: "Statement — July",
      subjectMatch: "exact",
      limit: 10,
      cursor: first.nextCursor,
    });

    expect(runner.requests[1]?.input).toMatchObject({
      subject: "Statement — July",
      subjectMatch: "exact",
      cursor: { scans: [{ index: 3, anchorMessageKey: "message-3" }] },
    });
    await expect(bridge.searchMessages({
      mailboxId,
      subject: "A different subject",
      subjectMatch: "exact",
      cursor: first.nextCursor,
    })).rejects.toMatchObject({ code: "INVALID_ID" });
    expect(runner.requests).toHaveLength(2);
  });

  it("maps nested mailboxes and rejects mismatched account and mailbox selectors", async () => {
    const runner = new FakeRunner();
    runner.enqueue([{ ...MAILBOX_LOCATOR, name: "Project", unreadCount: 3 }]);
    const bridge = makeBridge(runner);

    const mailboxes = await bridge.listMailboxes({
      accountId: encodeMailId("account", ACCOUNT_LOCATOR),
      includeNested: true,
    });

    expect(mailboxes[0]).toMatchObject({
      name: "Project",
      path: ["Inbox", "Project"],
      parentId: encodeMailId("mailbox", { accountKey: "account-1", path: ["Inbox"] }),
    });
    await expect(
      bridge.searchMessages({
        accountId: encodeMailId("account", { accountKey: "account-2" }),
        mailboxId: encodeMailId("mailbox", MAILBOX_LOCATOR),
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("maps bounded full body and attachment metadata without requesting attachment bytes", async () => {
    const runner = new FakeRunner();
    runner.enqueue({
      ...MESSAGE_LOCATOR,
      subject: "Report",
      sender: "sender@example.com",
      read: true,
      flagged: false,
      body: "bounded body",
      bodyTruncated: true,
      originalBodyChars: 10_000,
      headers: [{ name: "List-Id", value: "example" }],
      recipients: { to: [{ address: "to@example.com" }], cc: [], bcc: [] },
      attachments: [
        {
          ...MESSAGE_LOCATOR,
          attachmentKey: "attachment-1",
          filename: "report.pdf",
          mimeType: "application/pdf",
          sizeBytes: 512,
          downloaded: true,
        },
      ],
    });
    const bridge = makeBridge(runner);

    const result = await bridge.getMessage({
      messageId: encodeMailId("message", MESSAGE_LOCATOR),
      maxBodyChars: 500,
    });

    expect(runner.requests[0]?.input).toEqual({ message: MESSAGE_LOCATOR, maxBodyChars: 500 });
    expect(result.bodyTruncated).toBe(true);
    expect(decodeMailId("attachment", result.attachments[0]!.id)).toEqual({
      ...MESSAGE_LOCATOR,
      attachmentKey: "attachment-1",
    });
  });

  it("batch-reads selected messages in one bounded automation request", async () => {
    const runner = new FakeRunner();
    const secondLocator = { ...MAILBOX_LOCATOR, messageKey: "message-8" };
    const fullMessage = (locator: typeof MESSAGE_LOCATOR) => ({
      ...locator,
      subject: locator.messageKey,
      sender: "sender@example.com",
      read: true,
      flagged: false,
      body: "bounded body",
      bodyTruncated: false,
      originalBodyChars: 12,
      headers: [],
      recipients: { to: [], cc: [], bcc: [] },
      attachments: [],
    });
    runner.enqueue([fullMessage(MESSAGE_LOCATOR), fullMessage(secondLocator)]);
    const bridge = makeBridge(runner);
    const ids = [MESSAGE_LOCATOR, secondLocator].map((locator) => encodeMailId("message", locator));

    const result = await bridge.getMessages({ messageIds: ids, maxBodyChars: 500 });

    expect(runner.requests[0]?.input).toEqual({
      messages: [MESSAGE_LOCATOR, secondLocator],
      maxBodyChars: 500,
    });
    expect(result.map(({ subject }) => subject)).toEqual(["message-7", "message-8"]);
  });

  it("enforces result, body, attachment, and state bounds before automation", async () => {
    const runner = new FakeRunner();
    const bridge = makeBridge(runner);
    const messageId = encodeMailId("message", MESSAGE_LOCATOR);
    const attachmentId = encodeMailId("attachment", { ...MESSAGE_LOCATOR, attachmentKey: "a" });

    await expect(bridge.searchMessages({ limit: 51 })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(bridge.getMessage({ messageId, maxBodyChars: 1_001 })).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    await expect(bridge.getMessages({ messageIds: [] })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(bridge.getAttachment({ attachmentId, maxBytes: 1_025 })).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    await expect(bridge.setMessageState({ messageId })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(runner.requests).toHaveLength(0);
  });

  it("rejects a sender outside the account allowlist before creating a draft", async () => {
    const runner = new FakeRunner();
    const bridge = makeBridge(runner, ["allowed@example.com"]);

    await expect(
      bridge.createDraft({
        accountId: encodeMailId("account", ACCOUNT_LOCATOR),
        from: "other@example.com",
        to: ["to@example.com"],
        subject: "Subject",
        body: "Body",
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_NOT_ALLOWED" });

    expect(runner.requests).toHaveLength(0);
  });

  it("returns a versioned draft ID that can only resolve an outgoing draft locator", async () => {
    const runner = new FakeRunner();
    runner.enqueue({
      accountKey: "account-1",
      draftKey: "compose-9",
      sender: "allowed@example.com",
      subject: "Subject",
      sent: false,
    });
    const bridge = makeBridge(runner, ["allowed@example.com"]);

    const result = await bridge.createDraft({
      accountId: encodeMailId("account", ACCOUNT_LOCATOR),
      from: "allowed@example.com",
      to: ["to@example.com"],
      subject: "Subject",
      body: "Body",
    });

    expect(decodeMailId("draft", result.id)).toEqual({
      accountKey: "account-1",
      draftKey: "compose-9",
      sender: "allowed@example.com",
    });
    expect(result.sent).toBe(false);
  });

  it("maps attachment bytes, message-state changes, and reply/forward drafts", async () => {
    const runner = new FakeRunner();
    const attachmentLocator = { ...MESSAGE_LOCATOR, attachmentKey: "attachment-1" };
    const rawMessage = {
      ...MESSAGE_LOCATOR,
      subject: "Status",
      sender: "sender@example.com",
      read: true,
      flagged: true,
    };
    const rawDraft = {
      accountKey: "account-1",
      draftKey: "compose-9",
      sender: "allowed@example.com",
      subject: "Subject",
      sent: false,
    };
    runner.enqueue({
      ...attachmentLocator,
      filename: "note.txt",
      mimeType: "text/plain",
      sizeBytes: 4,
      downloaded: true,
      encoding: "base64",
      content: "dGVzdA==",
      truncated: false,
    });
    runner.enqueue(rawMessage);
    runner.enqueue(rawDraft);
    runner.enqueue(rawDraft);
    const bridge = makeBridge(runner, ["allowed@example.com"]);
    const messageId = encodeMailId("message", MESSAGE_LOCATOR);

    await expect(
      bridge.getAttachment({ attachmentId: encodeMailId("attachment", attachmentLocator), maxBytes: 8 }),
    ).resolves.toMatchObject({ content: "dGVzdA==", encoding: "base64", truncated: false });
    await expect(bridge.setMessageState({ messageId, read: true, flagged: true })).resolves.toMatchObject({
      read: true,
      flagged: true,
    });
    const reply = await bridge.createReplyDraft({
      messageId,
      from: "allowed@example.com",
      replyAll: true,
      body: "Reply",
    });
    await bridge.createForwardDraft({
      messageId,
      from: "allowed@example.com",
      to: ["to@example.com"],
      body: "Forward",
    });
    expect(reply.sent).toBe(false);

    expect(runner.requests.map(({ operation }) => operation)).toEqual([
      "getAttachment",
      "setMessageState",
      "createReplyDraft",
      "createForwardDraft",
    ]);
  });

  it("sends only explicitly confirmed, attachment-free messages and replies from allowlisted accounts", async () => {
    const runner = new FakeRunner();
    const rawSend = {
      accountKey: "account-1",
      sender: "allowed@example.com",
      subject: "Approved subject",
      recipients: {
        to: [{ address: "to@example.com" }],
        cc: [],
        bcc: [],
      },
      acceptedForSending: true,
    };
    runner.enqueue(rawSend);
    runner.enqueue({ ...rawSend, subject: "Re: Approved subject" });
    const bridge = makeBridge(runner, ["allowed@example.com"]);
    const messageId = encodeMailId("message", MESSAGE_LOCATOR);

    const sent = await bridge.sendMessage({
      accountId: encodeMailId("account", ACCOUNT_LOCATOR),
      from: "ALLOWED@example.com",
      to: ["TO@example.com"],
      subject: "Approved subject",
      body: "Approved body",
      confirmed: true,
    });
    const reply = await bridge.sendReply({
      messageId,
      from: "allowed@example.com",
      expectedTo: ["TO@example.com"],
      replyAll: false,
      body: "Approved reply",
      confirmed: true,
    });

    expect(sent).toMatchObject({
      accountId: encodeMailId("account", ACCOUNT_LOCATOR),
      acceptedForSending: true,
      recipients: { to: [{ address: "to@example.com" }] },
    });
    expect(reply.acceptedForSending).toBe(true);
    expect(runner.requests).toMatchObject([
      {
        operation: "sendMessage",
        input: {
          account: ACCOUNT_LOCATOR,
          from: "allowed@example.com",
          to: ["to@example.com"],
          body: "Approved body",
          confirmed: true,
        },
      },
      {
        operation: "sendReply",
        input: {
          message: MESSAGE_LOCATOR,
          from: "allowed@example.com",
          expectedTo: ["to@example.com"],
          expectedCc: [],
          expectedBcc: [],
          body: "Approved reply",
          confirmed: true,
        },
      },
    ]);
  });

  it("rejects unconfirmed sends, empty bodies, and send attempts without an allowlist", async () => {
    const runner = new FakeRunner();
    const unrestricted = makeBridge(runner);
    const allowlisted = makeBridge(runner, ["allowed@example.com"]);
    const accountId = encodeMailId("account", ACCOUNT_LOCATOR);
    const messageId = encodeMailId("message", MESSAGE_LOCATOR);

    await expect(
      allowlisted.sendMessage({
        accountId,
        from: "allowed@example.com",
        to: ["to@example.com"],
        subject: "Subject",
        body: "Body",
        confirmed: false as true,
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      allowlisted.sendReply({
        messageId,
        from: "allowed@example.com",
        expectedTo: ["to@example.com"],
        body: "   ",
        confirmed: true,
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      unrestricted.sendMessage({
        accountId,
        from: "allowed@example.com",
        to: ["to@example.com"],
        subject: "Subject",
        body: "Body",
        confirmed: true,
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });

    expect(runner.requests).toHaveLength(0);
  });

  it("allows a confirmed send without an allowlist only for prompted authorization", async () => {
    const runner = new FakeRunner();
    runner.enqueue({
      accountKey: "account-1",
      sender: "sender@example.com",
      subject: "Approved subject",
      recipients: { to: [{ address: "to@example.com" }], cc: [], bcc: [] },
      acceptedForSending: true,
    });
    const bridge = makeBridge(runner, [], true);

    await bridge.sendMessage({
      accountId: encodeMailId("account", ACCOUNT_LOCATOR),
      from: "sender@example.com",
      to: ["to@example.com"],
      subject: "Approved subject",
      body: "Approved body",
      confirmed: true,
    });

    expect(runner.requests[0]?.policy).toMatchObject({
      allowedAccounts: [],
      promptedSend: true,
    });
  });

  it("rejects empty recipient lists and invalid state types before automation", async () => {
    const runner = new FakeRunner();
    const bridge = makeBridge(runner);
    const messageId = encodeMailId("message", MESSAGE_LOCATOR);

    await expect(
      bridge.createDraft({
        accountId: encodeMailId("account", ACCOUNT_LOCATOR),
        from: "from@example.com",
        to: [],
        subject: "Subject",
        body: "Body",
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      bridge.createForwardDraft({ messageId, from: "from@example.com", to: [] }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      bridge.setMessageState({ messageId, read: "yes" as unknown as boolean }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      bridge.setMessageState({ messageId, flagged: "yes" as unknown as boolean }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(runner.requests).toHaveLength(0);
  });

  it("uses stable typed errors for invalid public IDs", async () => {
    const bridge = makeBridge(new FakeRunner());
    await expect(bridge.getMessage({ messageId: "not-an-id" })).rejects.toBeInstanceOf(MailBridgeError);
    await expect(bridge.getMessage({ messageId: "not-an-id" })).rejects.toMatchObject({ code: "INVALID_ID" });
  });
});
