import { readFileSync } from "node:fs";
import { runInContext, createContext, type Context } from "node:vm";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../../runtime/mailbridge.jxa.js", import.meta.url), "utf8");

interface JxaContext extends Context {
  run(argv: unknown[]): string;
}

function account(id: string, addresses: string[], mailboxes: unknown[] = []): Record<string, unknown> {
  return {
    id,
    name: id,
    emailAddresses: () => addresses,
    fullName: "Test User",
    enabled: true,
    mailboxes: () => mailboxes,
  };
}

function harness(accounts: unknown[]): { context: JxaContext; request(value: unknown): void } {
  let requestText = "";
  const inputData = {
    get length(): number {
      return Buffer.byteLength(requestText, "utf8");
    },
    get text(): string {
      return requestText;
    },
  };
  const foundation = Object.assign((value: unknown) => value, {
    NSFileHandle: { fileHandleWithStandardInput: { readDataToEndOfFile: inputData } },
    NSString: {
      alloc: {
        initWithDataEncoding(data: { text: string }): { text: string } {
          return { text: data.text };
        },
      },
    },
    NSUTF8StringEncoding: 4,
  });
  const mail = { accounts: () => accounts, includeStandardAdditions: false };
  const context = createContext({
    Buffer,
    $: foundation,
    ObjC: {
      import: () => undefined,
      unwrap: (value: { text?: string } | string): string => {
        if (typeof value === "string") return value;
        return value.text ?? "";
      },
    },
    Application: () => mail,
  }) as JxaContext;
  runInContext(source, context, { filename: "runtime/mailbridge.jxa.js" });
  return {
    context,
    request(value: unknown): void {
      requestText = JSON.stringify(value);
    },
  };
}

function request(operation: string, input: Record<string, unknown> = {}, allowedAccounts: string[] = []) {
  return {
    operation,
    input,
    policy: {
      allowedAccounts,
      maxBodyChars: 1_000,
      maxAttachmentBytes: 1_024,
      maxResults: 25,
      searchTimeBudgetMs: 12_000,
    },
  };
}

describe("fixed JXA dispatcher contract", () => {
  it("reads request JSON from stdin and refuses request data in argv", () => {
    const runtime = harness([account("account-1", ["person@example.com"])]);
    runtime.request(request("listAccounts"));

    expect(JSON.parse(runtime.context.run([]))).toMatchObject({
      ok: true,
      result: [{ accountKey: "account-1", emailAddresses: ["person@example.com"] }],
    });
    expect(JSON.parse(runtime.context.run(["secret request"]))).toMatchObject({
      ok: false,
      error: { code: "INVALID_REQUEST" },
    });
  });

  it("searches through indexed collection access and reports an exhausted scan budget", () => {
    const message = {
      id: "message-1",
      subject: "ordinary subject",
      sender: "sender@example.com",
      messageId: "rfc@example.com",
      readStatus: false,
      flaggedStatus: false,
    };
    const messages = new Proxy(
      () => {
        throw new Error("eager message enumeration is forbidden");
      },
      {
        get(target, property, receiver) {
          if (typeof property === "string" && /^\d+$/.test(property)) {
            return Number(property) <= 10_000 ? message : undefined;
          }
          const reflected: unknown = Reflect.get(target, property, receiver);
          return reflected;
        },
      },
    );
    const mailbox = { name: "Inbox", mailboxes: () => [], messages };
    const runtime = harness([account("account-1", ["person@example.com"], [mailbox])]);
    runtime.request(request("searchMessages", { query: "not-present", limit: 5 }));

    expect(JSON.parse(runtime.context.run([]))).toMatchObject({
      ok: true,
      result: { messages: [], scannedCount: 10_000, incomplete: true },
    });
  });

  it("applies metadata filters during a bounded indexed scan", () => {
    const message = {
      id: "message-1",
      subject: "Barclays account update",
      sender: "alerts@barclays.example",
      messageId: "rfc@example.com",
      dateReceived: new Date("2026-07-16T08:00:00.000Z"),
      readStatus: false,
      flaggedStatus: true,
    };
    const messages = new Proxy(() => undefined, {
      get(target, property, receiver) {
        if (property === "0") return message;
        if (property === "1") return undefined;
        if (property === "id") throw new Error("eager identity enumeration is forbidden");
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const mailbox = { name: "Inbox", mailboxes: () => [], messages };
    const runtime = harness([account("account-1", ["person@example.com"], [mailbox])]);
    runtime.request(
      request("searchMessages", {
        mailbox: { accountKey: "account-1", path: ["Inbox"] },
        query: "barclays",
        from: "Barclays",
        subject: "account",
        unread: true,
        flagged: true,
        dateFrom: "2026-07-16T00:00:00.000Z",
        dateTo: "2026-07-17T00:00:00.000Z",
        limit: 5,
      }),
    );

    expect(JSON.parse(runtime.context.run([]))).toMatchObject({
      ok: true,
      result: {
        messages: [{ messageKey: "message-1", subject: "Barclays account update" }],
        scannedCount: 1,
        incomplete: false,
      },
    });
  });

  it("merges newest Inbox streams without scanning every message", () => {
    function message(id: string, date: string): Record<string, unknown> {
      return {
        id,
        subject: id,
        sender: "sender@example.com",
        dateReceived: new Date(date),
        readStatus: true,
        flaggedStatus: false,
      };
    }
    const personalInbox = {
      name: "INBOX",
      mailboxes: () => [],
      messages: [
        message("personal-10", "2026-07-17T10:00:00.000Z"),
        message("personal-08", "2026-07-17T08:00:00.000Z"),
        message("personal-06", "2026-07-17T06:00:00.000Z"),
      ],
    };
    const workInbox = {
      name: "Inbox",
      mailboxes: () => [],
      messages: [
        message("work-09", "2026-07-17T09:00:00.000Z"),
        message("work-07", "2026-07-17T07:00:00.000Z"),
        message("work-05", "2026-07-17T05:00:00.000Z"),
      ],
    };
    const runtime = harness([
      account("personal", ["personal@example.com"], [personalInbox]),
      account("work", ["work@example.com"], [workInbox]),
    ]);
    runtime.request(request("searchMessages", { scope: "inbox", limit: 3 }));

    expect(JSON.parse(runtime.context.run([]))).toMatchObject({
      ok: true,
      result: {
        messages: [
          { accountKey: "personal", messageKey: "personal-10" },
          { accountKey: "work", messageKey: "work-09" },
          { accountKey: "personal", messageKey: "personal-08" },
        ],
        scannedCount: 4,
        incomplete: false,
      },
    });
  });

  it("returns the latest Inbox message after reading one candidate per account", () => {
    function message(id: string, date: string): Record<string, unknown> {
      return {
        id,
        subject: id,
        sender: "sender@example.com",
        dateReceived: new Date(date),
        readStatus: true,
        flaggedStatus: false,
      };
    }
    const runtime = harness([
      account("personal", ["personal@example.com"], [{
        name: "INBOX",
        mailboxes: () => [],
        messages: [message("personal-latest", "2026-07-17T10:00:00.000Z"), message("personal-old", "2026-07-16T10:00:00.000Z")],
      }]),
      account("work", ["work@example.com"], [{
        name: "Inbox",
        mailboxes: () => [],
        messages: [message("work-latest", "2026-07-17T09:00:00.000Z"), message("work-old", "2026-07-16T09:00:00.000Z")],
      }]),
    ]);
    runtime.request(request("searchMessages", { scope: "inbox", limit: 1 }));

    expect(JSON.parse(runtime.context.run([]))).toMatchObject({
      ok: true,
      result: {
        messages: [{ accountKey: "personal", messageKey: "personal-latest" }],
        scannedCount: 2,
        incomplete: false,
      },
    });
  });

  it("returns partial coverage when the internal search time budget expires", () => {
    const messages = ["message-1", "message-2"].map((id) => ({
      id,
      subject: id,
      sender: "sender@example.com",
      dateReceived: new Date("2026-07-17T10:00:00.000Z"),
      readStatus: true,
      flaggedStatus: false,
    }));
    const runtime = harness([
      account("account-1", ["person@example.com"], [{ name: "Inbox", mailboxes: () => [], messages }]),
    ]);
    runInContext(
      "Date.now = (function () { var now = 0; return function () { now += 6001; return now; }; })();",
      runtime.context,
    );
    runtime.request(request("searchMessages", { scope: "inbox", limit: 5 }));

    expect(JSON.parse(runtime.context.run([]))).toMatchObject({
      ok: true,
      result: {
        messages: [{ messageKey: "message-1" }],
        scannedCount: 1,
        incomplete: true,
      },
    });
  });

  it("fails closed when one allowlisted address belongs to multiple Mail accounts", () => {
    const runtime = harness([
      account("personal", ["shared@example.com"]),
      account("work", ["shared@example.com"]),
    ]);
    runtime.request(request("listAccounts", {}, ["shared@example.com"]));

    expect(JSON.parse(runtime.context.run([]))).toMatchObject({
      ok: false,
      error: { code: "AMBIGUOUS_ID" },
    });
  });

  it("distinguishes indexed-access failure from a genuine collection end", () => {
    const message = {
      id: "message-1",
      subject: "ordinary subject",
      sender: "sender@example.com",
      messageId: "rfc@example.com",
      readStatus: false,
      flaggedStatus: false,
    };
    const messages = new Proxy(() => undefined, {
      get(target, property, receiver) {
        if (property === "0") return message;
        if (property === "1") throw new Error("Mail collection access failed");
        const reflected: unknown = Reflect.get(target, property, receiver);
        return reflected;
      },
    });
    const mailbox = { name: "Inbox", mailboxes: () => [], messages };
    const runtime = harness([account("account-1", ["person@example.com"], [mailbox])]);
    runtime.request(request("searchMessages", { query: "not-present", limit: 5 }));

    expect(JSON.parse(runtime.context.run([]))).toMatchObject({
      ok: true,
      result: { messages: [], scannedCount: 1, incomplete: true },
    });

    runtime.request(
      request("getMessage", {
        message: { accountKey: "account-1", path: ["Inbox"], messageKey: "missing" },
        maxBodyChars: 100,
      }),
    );
    expect(JSON.parse(runtime.context.run([]))).toMatchObject({
      ok: false,
      error: { code: "MAIL_AUTOMATION_ERROR" },
    });
  });

  it("batch-reads selected message bodies in one dispatcher operation", () => {
    const messages = ["message-1", "message-2"].map((id) => ({
      id,
      subject: id,
      sender: "sender@example.com",
      dateReceived: new Date("2026-07-17T10:00:00.000Z"),
      readStatus: true,
      flaggedStatus: false,
      content: `${id} body`,
      headers: [],
      toRecipients: [],
      ccRecipients: [],
      bccRecipients: [],
      mailAttachments: [],
    }));
    const mailbox = { name: "Inbox", mailboxes: () => [], messages };
    const runtime = harness([account("account-1", ["person@example.com"], [mailbox])]);
    runtime.request(
      request("getMessages", {
        messages: [
          { accountKey: "account-1", path: ["Inbox"], messageKey: "message-1" },
          { accountKey: "account-1", path: ["Inbox"], messageKey: "message-2" },
        ],
        maxBodyChars: 100,
      }),
    );

    expect(JSON.parse(runtime.context.run([]))).toMatchObject({
      ok: true,
      result: [
        { messageKey: "message-1", body: "message-1 body" },
        { messageKey: "message-2", body: "message-2 body" },
      ],
    });
  });

  it("contains no send operation or dynamic-code primitive", () => {
    expect(source).not.toMatch(/mail_send_draft|sendDraft|Mail\.send|\beval\s*\(|new Function/);
  });
});
