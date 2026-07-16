import process from "node:process";

const DEFAULT_CHILD_ENVIRONMENT_KEYS = [
  "HOME",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "USER",
  "LOGNAME"
] as const;

/** Builds a deliberately small subprocess environment without inheriting host secrets. */
export function buildMinimalChildEnvironment(
  source: NodeJS.ProcessEnv = process.env,
  fixed: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" }
): NodeJS.ProcessEnv {
  const childEnvironment: NodeJS.ProcessEnv = { ...fixed };
  for (const name of DEFAULT_CHILD_ENVIRONMENT_KEYS) {
    const value = source[name];
    if (value !== undefined) childEnvironment[name] = value;
  }
  return childEnvironment;
}

/** Serializes one request and fails before transport if its UTF-8 representation is too large. */
export function stringifyBoundedJson(
  value: unknown,
  maximumBytes: number,
  createError: () => Error = () => new RangeError("Serialized JSON exceeds its byte limit.")
): string {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new RangeError("maximumBytes must be a positive safe integer.");
  }
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > maximumBytes) throw createError();
  return serialized;
}

/** A bounded FIFO used to serialize non-idempotent MCP operations. */
export class BoundedSerialQueue {
  private tail: Promise<void> = Promise.resolve();
  private queuedCount = 0;

  public constructor(private readonly maximumQueued: number) {
    if (!Number.isSafeInteger(maximumQueued) || maximumQueued < 1) {
      throw new RangeError("maximumQueued must be a positive safe integer.");
    }
  }

  public get queued(): number {
    return this.queuedCount;
  }

  public async run<T>(operation: () => Promise<T>, createBusyError: () => Error): Promise<T> {
    if (this.queuedCount >= this.maximumQueued) throw createBusyError();
    this.queuedCount += 1;
    const previous = this.tail;
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tail = previous.then(() => current);
    await previous;
    try {
      return await operation();
    } finally {
      this.queuedCount -= 1;
      release();
    }
  }
}
