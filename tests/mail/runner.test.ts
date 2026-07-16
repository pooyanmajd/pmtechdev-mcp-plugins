import { EventEmitter } from "node:events";
import { stat } from "node:fs/promises";
import { PassThrough } from "node:stream";
import type { spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MailBridgeError } from "../../src/mail/errors.js";
import { OsascriptAutomationRunner, type AutomationRequest } from "../../src/mail/runner.js";

const REQUEST: AutomationRequest = {
  operation: "searchMessages",
  input: { query: "'; Application('Finder').quit(); //" },
  policy: {
    allowedAccounts: [],
    maxBodyChars: 1_000,
    maxAttachmentBytes: 1_024,
    maxResults: 25,
  },
};

const ATTACHMENT_REQUEST: AutomationRequest = {
  ...REQUEST,
  operation: "getAttachment",
  input: { attachment: { accountKey: "a", path: ["Inbox"], messageKey: "m", attachmentKey: "t" } },
};

interface FakeChild extends EventEmitter {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
}

function fakeSpawn(
  action: (child: FakeChild) => void,
): { spawnProcess: typeof spawn; calls: unknown[][]; child: FakeChild } {
  const child = new EventEmitter() as FakeChild;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => {
    queueMicrotask(() => child.emit("close", null, "SIGKILL"));
    return true;
  });
  const calls: unknown[][] = [];
  const spawnProcess = ((...args: unknown[]) => {
    calls.push(args);
    queueMicrotask(() => action(child));
    return child;
  }) as unknown as typeof spawn;
  return { spawnProcess, calls, child };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("OsascriptAutomationRunner", () => {
  it("fails on non-macOS without spawning", async () => {
    const process = fakeSpawn(() => undefined);
    const runner = new OsascriptAutomationRunner({ platform: "linux", spawnProcess: process.spawnProcess });

    await expect(runner.run(REQUEST)).rejects.toMatchObject({ code: "UNSUPPORTED_PLATFORM" });
    expect(process.calls).toHaveLength(0);
  });

  it("passes caller data only over stdin to a fixed script path and a minimal environment", async () => {
    const process = fakeSpawn((child) => {
      child.stdout.end(JSON.stringify({ ok: true, result: [{ safe: true }] }));
      child.emit("close", 0, null);
    });
    const runner = new OsascriptAutomationRunner({
      platform: "darwin",
      scriptPath: "/fixed/runtime/mailbridge.jxa.js",
      spawnProcess: process.spawnProcess,
    });

    await expect(runner.run(REQUEST)).resolves.toEqual([{ safe: true }]);
    expect(process.calls[0]?.[0]).toBe("/usr/bin/osascript");
    expect(process.calls[0]?.[1]).toEqual([
      "-l",
      "JavaScript",
      "/fixed/runtime/mailbridge.jxa.js",
    ]);
    expect((process.calls[0]?.[1] as string[]).join(" ")).not.toContain(REQUEST.input.query as string);
    const requestData = process.child.stdin.read() as Buffer | null;
    expect(requestData?.toString("utf8")).toBe(JSON.stringify(REQUEST));
    const options = process.calls[0]?.[2] as { env?: Record<string, string>; stdio?: string[] };
    expect(options.stdio).toEqual(["pipe", "pipe", "pipe"]);
    expect(Object.keys(options.env ?? {}).sort()).toEqual(
      expect.arrayContaining(["PATH"]),
    );
    expect(Object.keys(options.env ?? {})).toEqual(
      expect.not.arrayContaining(["AWS_SECRET_ACCESS_KEY", "GITHUB_TOKEN", "OPENAI_API_KEY"]),
    );
  });

  it("maps a dispatcher failure envelope to a stable typed error", async () => {
    const process = fakeSpawn((child) => {
      child.stdout.end(
        JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "Message no longer exists." } }),
      );
      child.emit("close", 0, null);
    });
    const runner = new OsascriptAutomationRunner({
      platform: "darwin",
      scriptPath: "/fixed/runtime/mailbridge.jxa.js",
      spawnProcess: process.spawnProcess,
    });

    await expect(runner.run(REQUEST)).rejects.toEqual(
      expect.objectContaining<Partial<MailBridgeError>>({ code: "NOT_FOUND" }),
    );
  });

  it("maps macOS Apple Event authorization denial without leaking diagnostics", async () => {
    const process = fakeSpawn((child) => {
      child.stderr.end("execution error: Not authorized to send Apple events to Mail. (-1743)");
      child.emit("close", 1, null);
    });
    const runner = new OsascriptAutomationRunner({
      platform: "darwin",
      scriptPath: "/fixed/runtime/mailbridge.jxa.js",
      spawnProcess: process.spawnProcess,
    });

    const error: unknown = await runner.run(REQUEST).then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toMatchObject({ code: "AUTOMATION_DENIED" });
    expect(error).toBeInstanceOf(Error);
    if (error instanceof Error) expect(error.message).not.toContain("-1743");
  });

  it("kills and reports subprocess timeouts", async () => {
    vi.useFakeTimers();
    const process = fakeSpawn(() => undefined);
    const runner = new OsascriptAutomationRunner({
      platform: "darwin",
      scriptPath: "/fixed/runtime/mailbridge.jxa.js",
      timeoutMs: 25,
      spawnProcess: process.spawnProcess,
    });

    const result = runner.run(REQUEST);
    const rejection = expect(result).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(26);
    await rejection;
    expect(process.child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("rejects bounded-output overflow", async () => {
    const process = fakeSpawn((child) => {
      child.stdout.end("x".repeat(101));
      queueMicrotask(() => child.emit("close", null, "SIGKILL"));
    });
    const runner = new OsascriptAutomationRunner({
      platform: "darwin",
      scriptPath: "/fixed/runtime/mailbridge.jxa.js",
      maxStdoutBytes: 100,
      spawnProcess: process.spawnProcess,
    });

    await expect(runner.run(REQUEST)).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
  });

  it("owns and removes the private attachment directory after the child closes", async () => {
    let privateDirectory = "";
    const process = fakeSpawn((child) => {
      const data = child.stdin.read() as Buffer | null;
      const parsed = JSON.parse(data?.toString("utf8") ?? "{}") as AutomationRequest;
      privateDirectory = parsed.policy.attachmentDirectory ?? "";
      child.stdout.end(JSON.stringify({ ok: true, result: { content: "dGVzdA==" } }));
      child.emit("close", 0, null);
    });
    const runner = new OsascriptAutomationRunner({
      platform: "darwin",
      scriptPath: "/fixed/runtime/mailbridge.jxa.js",
      spawnProcess: process.spawnProcess,
    });

    await expect(runner.run(ATTACHMENT_REQUEST)).resolves.toMatchObject({ content: "dGVzdA==" });
    expect(privateDirectory).toContain("mailbridge-");
    await expect(stat(privateDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("handles an early stdin EPIPE through the normal child failure path", async () => {
    const process = fakeSpawn((child) => {
      child.stdin.emit("error", Object.assign(new Error("broken pipe"), { code: "EPIPE" }));
      child.stderr.end("child exited before reading");
      child.emit("close", 1, null);
    });
    const runner = new OsascriptAutomationRunner({
      platform: "darwin",
      scriptPath: "/fixed/runtime/mailbridge.jxa.js",
      spawnProcess: process.spawnProcess,
    });

    await expect(runner.run(REQUEST)).rejects.toMatchObject({ code: "MAIL_AUTOMATION_ERROR" });
  });
});
