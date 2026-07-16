import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { MailBridgeError, isMailBridgeErrorCode } from "./errors.js";

export const AUTOMATION_OPERATIONS = [
  "listAccounts",
  "listMailboxes",
  "searchMessages",
  "getMessage",
  "getAttachment",
  "setMessageState",
  "createDraft",
  "createReplyDraft",
  "createForwardDraft",
] as const;

export type AutomationOperation = (typeof AUTOMATION_OPERATIONS)[number];

export interface AutomationRequest {
  operation: AutomationOperation;
  input: Record<string, unknown>;
  policy: {
    allowedAccounts: string[];
    maxBodyChars: number;
    maxAttachmentBytes: number;
    maxResults: number;
    attachmentDirectory?: string;
  };
}

export interface AutomationRunner {
  run<T>(request: AutomationRequest): Promise<T>;
}

export interface ProcessRunnerOptions {
  scriptPath?: string;
  timeoutMs?: number;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  platform?: NodeJS.Platform;
  spawnProcess?: typeof spawn;
}

interface DispatcherSuccess {
  ok: true;
  result: unknown;
}

interface DispatcherFailure {
  ok: false;
  error: {
    code?: unknown;
    message?: unknown;
    details?: unknown;
  };
}

const DEFAULT_TIMEOUT_MS = 15_000;
// 5 MiB attachment content expands to roughly 6.67 MiB as base64, plus its envelope.
const DEFAULT_MAX_STDOUT_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_STDERR_BYTES = 64 * 1024;
const MAX_REQUEST_BYTES = 1024 * 1024;

function defaultScriptPath(): string {
  const moduleDirectory = fileURLToPath(new URL(".", import.meta.url));
  if (basename(moduleDirectory) === "dist") {
    return resolve(moduleDirectory, "../runtime/mailbridge.jxa.js");
  }
  if (basename(moduleDirectory) === "mail" && basename(dirname(moduleDirectory)) === "src") {
    return resolve(moduleDirectory, "../../runtime/mailbridge.jxa.js");
  }
  // Unknown layouts fail closed beside the module instead of searching cwd or ancestors.
  return resolve(moduleDirectory, "runtime/mailbridge.jxa.js");
}

function childEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" };
  for (const name of ["HOME", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "USER", "LOGNAME"] as const) {
    const value = env[name];
    if (value !== undefined) childEnv[name] = value;
  }
  return childEnv;
}

function appendBounded(
  chunks: Buffer[],
  chunk: Buffer,
  currentBytes: number,
  maximumBytes: number,
  child: { kill(signal?: NodeJS.Signals | number): boolean },
): number {
  const nextBytes = currentBytes + chunk.byteLength;
  if (nextBytes > maximumBytes) {
    child.kill("SIGKILL");
    return nextBytes;
  }
  chunks.push(chunk);
  return nextBytes;
}

/** Executes only the repository's fixed JXA dispatcher, passing bounded data over stdin. */
export class OsascriptAutomationRunner implements AutomationRunner {
  readonly scriptPath: string;
  readonly timeoutMs: number;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
  readonly platform: NodeJS.Platform;
  readonly spawnProcess: typeof spawn;

  constructor(options: ProcessRunnerOptions = {}) {
    this.scriptPath = resolve(options.scriptPath ?? defaultScriptPath());
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxStdoutBytes = options.maxStdoutBytes ?? DEFAULT_MAX_STDOUT_BYTES;
    this.maxStderrBytes = options.maxStderrBytes ?? DEFAULT_MAX_STDERR_BYTES;
    this.platform = options.platform ?? process.platform;
    this.spawnProcess = options.spawnProcess ?? spawn;
  }

  async run<T>(request: AutomationRequest): Promise<T> {
    if (this.platform !== "darwin") {
      throw new MailBridgeError("UNSUPPORTED_PLATFORM", "Mailbridge requires macOS and Mail.app.");
    }

    let attachmentDirectory: string | undefined;
    try {
      if (request.operation === "getAttachment") {
        attachmentDirectory = await mkdtemp(join(tmpdir(), "mailbridge-"));
        await chmod(attachmentDirectory, 0o700);
      }
      const runtimeRequest: AutomationRequest = attachmentDirectory
        ? { ...request, policy: { ...request.policy, attachmentDirectory } }
        : request;
      const serialized = JSON.stringify(runtimeRequest);
      if (Buffer.byteLength(serialized, "utf8") > MAX_REQUEST_BYTES) {
        throw new MailBridgeError("INVALID_REQUEST", "The Mail automation request is too large.");
      }

      return await new Promise<T>((resolvePromise, rejectPromise) => {
        const child = this.spawnProcess(
          "/usr/bin/osascript",
          ["-l", "JavaScript", this.scriptPath],
          { stdio: ["pipe", "pipe", "pipe"], env: childEnvironment() },
        );
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let timedOut = false;
        let settled = false;

        const finish = (callback: () => void): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          callback();
        };

        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, this.timeoutMs);
        timer.unref();

        // A fast osascript failure can close stdin before the request is written.
        // The child close/error handlers below produce the stable public error.
        child.stdin.on("error", () => undefined);
        child.stdin.end(serialized, "utf8");

        child.stdout.on("data", (chunk: Buffer | string) => {
          stdoutBytes = appendBounded(
            stdout,
            Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
            stdoutBytes,
            this.maxStdoutBytes,
            child,
          );
        });
        child.stderr.on("data", (chunk: Buffer | string) => {
          stderrBytes = appendBounded(
            stderr,
            Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
            stderrBytes,
            this.maxStderrBytes,
            child,
          );
        });

        child.once("error", (error) => {
          finish(() => {
            rejectPromise(
              new MailBridgeError("MAIL_AUTOMATION_ERROR", "Unable to start Mail.app automation.", undefined, {
                cause: error,
              }),
            );
          });
        });

        child.once("close", (code, signal) => {
          finish(() => {
            if (timedOut) {
              rejectPromise(new MailBridgeError("TIMEOUT", "Mail.app automation timed out."));
              return;
            }
            if (stdoutBytes > this.maxStdoutBytes || stderrBytes > this.maxStderrBytes) {
              rejectPromise(
                new MailBridgeError("RESPONSE_TOO_LARGE", "Mail.app automation produced too much output."),
              );
              return;
            }

            const output = Buffer.concat(stdout).toString("utf8").trim();
            const diagnostic = Buffer.concat(stderr).toString("utf8");
            if (code !== 0) {
              rejectPromise(mapProcessFailure(code, signal, diagnostic));
              return;
            }

            try {
              const envelope = JSON.parse(output) as DispatcherSuccess | DispatcherFailure;
              if (!envelope || typeof envelope !== "object" || typeof envelope.ok !== "boolean") {
                throw new Error("Invalid dispatcher envelope");
              }
              if (!envelope.ok) {
                const codeValue = isMailBridgeErrorCode(envelope.error?.code)
                  ? envelope.error.code
                  : "MAIL_AUTOMATION_ERROR";
                const message =
                  typeof envelope.error?.message === "string"
                    ? envelope.error.message
                    : "Mail.app automation failed.";
                const details =
                  envelope.error?.details && typeof envelope.error.details === "object"
                    ? (envelope.error.details as Record<string, unknown>)
                    : undefined;
                rejectPromise(new MailBridgeError(codeValue, message, details));
                return;
              }
              resolvePromise(envelope.result as T);
            } catch (error) {
              rejectPromise(
                new MailBridgeError(
                  "MAIL_AUTOMATION_ERROR",
                  "Mail.app automation returned an invalid response.",
                  undefined,
                  { cause: error },
                ),
              );
            }
          });
        });
      });
    } finally {
      if (attachmentDirectory !== undefined) {
        await rm(attachmentDirectory, { recursive: true, force: true });
      }
    }
  }
}

function mapProcessFailure(
  code: number | null,
  signal: NodeJS.Signals | null,
  diagnostic: string,
): MailBridgeError {
  // Apple Event authorization denial is -1743. osascript commonly reports it in stderr.
  if (/(-1743|not authorized|not permitted to send apple events|automation permission)/i.test(diagnostic)) {
    return new MailBridgeError(
      "AUTOMATION_DENIED",
      "macOS denied permission to automate Mail.app. Enable Mail automation access and try again.",
    );
  }
  if (/application isn.t running|application .*mail.*not found|connection is invalid/i.test(diagnostic)) {
    return new MailBridgeError("MAIL_NOT_CONFIGURED", "Mail.app is unavailable or not configured.");
  }
  return new MailBridgeError("MAIL_AUTOMATION_ERROR", "Mail.app automation failed.", {
    exitCode: code,
    signal,
  });
}
