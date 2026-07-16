import { MailBridgeError } from "./errors.js";

export type MailIdKind = "account" | "mailbox" | "message" | "attachment" | "draft";

const PREFIX_BY_KIND: Record<MailIdKind, string> = {
  account: "mb1.a.",
  mailbox: "mb1.b.",
  message: "mb1.m.",
  attachment: "mb1.t.",
  draft: "mb1.d.",
};

const MAX_ID_CHARS = 4_096;
const MAX_COMPONENT_CHARS = 4_096;

export interface AccountLocator {
  accountKey: string;
}

export interface MailboxLocator extends AccountLocator {
  path: string[];
}

export interface MessageLocator extends MailboxLocator {
  messageKey: string;
}

export interface AttachmentLocator extends MessageLocator {
  attachmentKey: string;
}

export interface DraftLocator extends AccountLocator {
  draftKey: string;
  sender: string;
}

type LocatorByKind = {
  account: AccountLocator;
  mailbox: MailboxLocator;
  message: MessageLocator;
  attachment: AttachmentLocator;
  draft: DraftLocator;
};

const KEYS_BY_KIND: Record<MailIdKind, readonly string[]> = {
  account: ["accountKey"],
  mailbox: ["accountKey", "path"],
  message: ["accountKey", "messageKey", "path"],
  attachment: ["accountKey", "attachmentKey", "messageKey", "path"],
  draft: ["accountKey", "draftKey", "sender"],
};

function invalidId(): never {
  throw new MailBridgeError("INVALID_ID", "The supplied Mailbridge identifier is invalid.");
}

function validText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_COMPONENT_CHARS &&
    !value.includes("\0")
  );
}

function validatePath(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 64 &&
    value.every(validText)
  );
}

function validateLocator<K extends MailIdKind>(kind: K, value: unknown): LocatorByKind[K] {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidId();
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record).sort();
  const expectedKeys = [...KEYS_BY_KIND[kind]].sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    invalidId();
  }
  if (!validText(record.accountKey)) invalidId();

  if (kind === "account") return { accountKey: record.accountKey } as LocatorByKind[K];
  if ((kind === "mailbox" || kind === "message" || kind === "attachment") && !validatePath(record.path)) {
    invalidId();
  }
  if ((kind === "message" || kind === "attachment") && !validText(record.messageKey)) invalidId();
  if (kind === "attachment" && !validText(record.attachmentKey)) invalidId();
  if (kind === "draft" && (!validText(record.draftKey) || !validText(record.sender))) invalidId();
  return record as unknown as LocatorByKind[K];
}

export function encodeMailId<K extends MailIdKind>(kind: K, locator: LocatorByKind[K]): string {
  const checked = validateLocator(kind, locator);
  const encoded = `${PREFIX_BY_KIND[kind]}${Buffer.from(JSON.stringify(checked), "utf8").toString("base64url")}`;
  if (encoded.length > MAX_ID_CHARS) invalidId();
  return encoded;
}

export function decodeMailId<K extends MailIdKind>(kind: K, id: string): LocatorByKind[K] {
  if (typeof id !== "string" || id.length > MAX_ID_CHARS || !id.startsWith(PREFIX_BY_KIND[kind])) {
    invalidId();
  }
  const encoded = id.slice(PREFIX_BY_KIND[kind].length);
  if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) invalidId();
  try {
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    // Reject non-canonical encodings and payloads with smuggled trailing data.
    if (Buffer.from(decoded, "utf8").toString("base64url") !== encoded) invalidId();
    return validateLocator(kind, JSON.parse(decoded) as unknown);
  } catch (error) {
    if (error instanceof MailBridgeError) throw error;
    return invalidId();
  }
}

export function isMailId(kind: MailIdKind, id: string): boolean {
  try {
    decodeMailId(kind, id);
    return true;
  } catch {
    return false;
  }
}
