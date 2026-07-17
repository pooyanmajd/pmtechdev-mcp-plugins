import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { MailBridgeError } from "./errors.js";

const CURSOR_PREFIX = "mb1.s.";
const MAX_CURSOR_CHARS = 128 * 1024;
const MAX_CURSOR_SCANS = 256;
const MAX_CURSOR_INDEX = 10_000_000;
const MAX_COMPONENT_CHARS = 4_096;
const CURSOR_AUTHENTICATION_KEY = randomBytes(32);

export interface SearchScanCursor {
  accountKey: string;
  path: string[];
  index: number;
  native: boolean;
  done: boolean;
  anchorMessageKey?: string;
}

export interface SearchCursorState {
  scans: SearchScanCursor[];
}

interface SearchCursorPayload extends SearchCursorState {
  binding: string;
}

function invalidCursor(): never {
  throw new MailBridgeError("INVALID_ID", "The supplied search cursor is invalid or stale.");
}

function validText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_COMPONENT_CHARS &&
    !value.includes("\0")
  );
}

function validPath(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 64 && value.every(validText);
}

function validateScan(value: unknown): SearchScanCursor {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidCursor();
  const record = value as Record<string, unknown>;
  const expectedKeys = ["accountKey", "anchorMessageKey", "done", "index", "native", "path"];
  const actualKeys = Object.keys(record).sort();
  if (
    actualKeys.some((key) => !expectedKeys.includes(key)) ||
    !validText(record.accountKey) ||
    !validPath(record.path) ||
    !Number.isSafeInteger(record.index) ||
    Number(record.index) < 0 ||
    Number(record.index) > MAX_CURSOR_INDEX ||
    typeof record.native !== "boolean" ||
    typeof record.done !== "boolean" ||
    (record.anchorMessageKey !== undefined && !validText(record.anchorMessageKey)) ||
    (Number(record.index) > 0 && record.done === false && !validText(record.anchorMessageKey))
  ) {
    invalidCursor();
  }

  return {
    accountKey: record.accountKey,
    path: record.path,
    index: Number(record.index),
    native: record.native,
    done: record.done,
    ...(record.anchorMessageKey === undefined
      ? {}
      : { anchorMessageKey: record.anchorMessageKey }),
  };
}

function validatePayload(value: unknown): SearchCursorPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidCursor();
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record).sort();
  if (
    actualKeys.length !== 2 ||
    actualKeys[0] !== "binding" ||
    actualKeys[1] !== "scans" ||
    typeof record.binding !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.binding) ||
    !Array.isArray(record.scans) ||
    record.scans.length === 0 ||
    record.scans.length > MAX_CURSOR_SCANS
  ) {
    invalidCursor();
  }

  const scans = record.scans.map(validateScan);
  const uniqueMailboxes = new Set(scans.map((scan) => `${scan.accountKey}\0${scan.path.join("\0")}`));
  if (uniqueMailboxes.size !== scans.length) invalidCursor();
  return { binding: record.binding, scans };
}

export function createSearchBinding(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export function encodeSearchCursor(state: SearchCursorState, binding: string): string {
  const payload = validatePayload({ binding, scans: state.scans });
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", CURSOR_AUTHENTICATION_KEY)
    .update(encodedPayload, "utf8")
    .digest("hex");
  const encoded = `${CURSOR_PREFIX}${encodedPayload}.${signature}`;
  if (encoded.length > MAX_CURSOR_CHARS) invalidCursor();
  return encoded;
}

export function decodeSearchCursor(cursor: string, expectedBinding: string): SearchCursorState {
  if (
    typeof cursor !== "string" ||
    cursor.length > MAX_CURSOR_CHARS ||
    !cursor.startsWith(CURSOR_PREFIX)
  ) {
    invalidCursor();
  }
  const encoded = cursor.slice(CURSOR_PREFIX.length);
  const parts = encoded.split(".");
  if (
    parts.length !== 2 ||
    !parts[0] ||
    !/^[A-Za-z0-9_-]+$/.test(parts[0]) ||
    !/^[a-f0-9]{64}$/.test(parts[1] ?? "")
  ) {
    invalidCursor();
  }

  try {
    const encodedPayload = parts[0];
    const suppliedSignature = Buffer.from(parts[1]!, "hex");
    const expectedSignature = createHmac("sha256", CURSOR_AUTHENTICATION_KEY)
      .update(encodedPayload, "utf8")
      .digest();
    if (
      suppliedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(suppliedSignature, expectedSignature)
    ) {
      invalidCursor();
    }
    const decoded = Buffer.from(encodedPayload, "base64url").toString("utf8");
    if (Buffer.from(decoded, "utf8").toString("base64url") !== encodedPayload) invalidCursor();
    const payload = validatePayload(JSON.parse(decoded) as unknown);
    if (payload.binding !== expectedBinding) invalidCursor();
    return { scans: payload.scans };
  } catch (error) {
    if (error instanceof MailBridgeError) throw error;
    return invalidCursor();
  }
}
