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

  it("contains no send operation or dynamic-code primitive", () => {
    expect(source).not.toMatch(/mail_send_draft|sendDraft|Mail\.send|\beval\s*\(|new Function/);
  });
});
