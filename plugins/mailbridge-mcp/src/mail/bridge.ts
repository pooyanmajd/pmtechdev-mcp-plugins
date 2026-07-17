import { MailBridgeError } from "./errors.js";
import {
  decodeMailId,
  encodeMailId,
  type AccountLocator,
  type AttachmentLocator,
  type DraftLocator,
  type MailboxLocator,
  type MessageLocator,
} from "./ids.js";
import {
  OsascriptAutomationRunner,
  type AutomationRequest,
  type AutomationRunner,
} from "./runner.js";

export { MailBridgeError, type MailBridgeErrorCode } from "./errors.js";
export { OsascriptAutomationRunner, type AutomationRequest, type AutomationRunner } from "./runner.js";
export { decodeMailId, encodeMailId, isMailId, type MailIdKind } from "./ids.js";

export interface MailAccount {
  id: string;
  name: string;
  emailAddresses: string[];
  fullName?: string;
  enabled: boolean;
}

export interface Mailbox {
  id: string;
  accountId: string;
  parentId?: string;
  name: string;
  path: string[];
  unreadCount: number;
}

export interface MailRecipient {
  name?: string;
  address: string;
}

export interface MailRecipients {
  to: MailRecipient[];
  cc: MailRecipient[];
  bcc: MailRecipient[];
}

export interface MailHeader {
  name: string;
  value: string;
}

export interface MessageSummary {
  id: string;
  rfcMessageId?: string;
  accountId: string;
  mailboxId: string;
  subject: string;
  sender: string;
  dateReceived?: string;
  dateSent?: string;
  read: boolean;
  flagged: boolean;
  sizeBytes?: number;
}

export interface SearchMessagesResult {
  messages: MessageSummary[];
  scannedCount: number;
  incomplete: boolean;
}

export interface AttachmentMetadata {
  id: string;
  messageId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  downloaded: boolean;
}

export interface FullMessage extends MessageSummary {
  body: string;
  bodyTruncated: boolean;
  originalBodyChars: number;
  replyTo?: string;
  headers: MailHeader[];
  recipients: MailRecipients;
  attachments: AttachmentMetadata[];
}

export interface AttachmentContent extends AttachmentMetadata {
  encoding: "base64";
  content: string;
  truncated: false;
}

export interface ListMailboxesInput {
  accountId?: string;
  includeNested?: boolean;
}

export interface SearchMessagesInput {
  accountId?: string;
  mailboxId?: string;
  scope?: "inbox" | "all";
  query?: string;
  from?: string;
  to?: string;
  subject?: string;
  dateFrom?: string;
  dateTo?: string;
  unread?: boolean;
  flagged?: boolean;
  limit?: number;
}

export interface GetMessageInput {
  messageId: string;
  maxBodyChars?: number;
}

export interface GetMessagesInput {
  messageIds: string[];
  maxBodyChars?: number;
}

export interface GetAttachmentInput {
  attachmentId: string;
  maxBytes?: number;
}

export interface SetMessageStateInput {
  messageId: string;
  read?: boolean;
  flagged?: boolean;
}

export interface DraftAddressing {
  to: string[];
  cc?: string[];
  bcc?: string[];
}

export interface CreateDraftInput extends DraftAddressing {
  accountId: string;
  from: string;
  subject: string;
  body: string;
}

export interface CreateReplyDraftInput {
  messageId: string;
  from: string;
  replyAll?: boolean;
  body?: string;
}

export interface CreateForwardDraftInput extends DraftAddressing {
  messageId: string;
  from: string;
  body?: string;
}

export interface SendMessageInput extends CreateDraftInput {
  confirmed: true;
}

export interface SendReplyInput {
  messageId: string;
  from: string;
  expectedTo: string[];
  expectedCc?: string[];
  expectedBcc?: string[];
  replyAll?: boolean;
  body: string;
  confirmed: true;
}

export interface DraftResult {
  id: string;
  accountId: string;
  from: string;
  subject: string;
  sent: boolean;
}

export interface SendResult {
  accountId: string;
  from: string;
  subject: string;
  recipients: MailRecipients;
  acceptedForSending: true;
}

export interface MailBridge {
  listAccounts(): Promise<MailAccount[]>;
  listMailboxes(input?: ListMailboxesInput): Promise<Mailbox[]>;
  searchMessages(input: SearchMessagesInput): Promise<SearchMessagesResult>;
  getMessage(input: GetMessageInput): Promise<FullMessage>;
  getMessages(input: GetMessagesInput): Promise<FullMessage[]>;
  getAttachment(input: GetAttachmentInput): Promise<AttachmentContent>;
  setMessageState(input: SetMessageStateInput): Promise<MessageSummary>;
  createDraft(input: CreateDraftInput): Promise<DraftResult>;
  createReplyDraft(input: CreateReplyDraftInput): Promise<DraftResult>;
  createForwardDraft(input: CreateForwardDraftInput): Promise<DraftResult>;
  sendMessage(input: SendMessageInput): Promise<SendResult>;
  sendReply(input: SendReplyInput): Promise<SendResult>;
}

export interface AppleMailBridgeOptions {
  allowedAccounts?: string[];
  maxBodyChars: number;
  timeoutMs: number;
  maxResults?: number;
  maxAttachmentBytes?: number;
  runner?: AutomationRunner;
}

interface RawAccount extends AccountLocator {
  name: string;
  emailAddresses: string[];
  fullName?: string;
  enabled: boolean;
}

interface RawMailbox extends MailboxLocator {
  name: string;
  unreadCount: number;
}

interface RawMessageSummary extends MessageLocator {
  rfcMessageId?: string;
  subject: string;
  sender: string;
  dateReceived?: string;
  dateSent?: string;
  read: boolean;
  flagged: boolean;
  sizeBytes?: number;
}

interface RawSearchMessagesResult {
  messages: RawMessageSummary[];
  scannedCount: number;
  incomplete: boolean;
}

interface RawAttachment extends AttachmentLocator {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  downloaded: boolean;
}

interface RawFullMessage extends RawMessageSummary {
  body: string;
  bodyTruncated: boolean;
  originalBodyChars: number;
  replyTo?: string;
  headers: MailHeader[];
  recipients: MailRecipients;
  attachments: RawAttachment[];
}

interface RawAttachmentContent extends RawAttachment {
  encoding: "base64";
  content: string;
  truncated: false;
}

interface RawDraftResult extends DraftLocator {
  subject: string;
  sent: boolean;
}

interface RawSendResult extends AccountLocator {
  sender: string;
  subject: string;
  recipients: MailRecipients;
  acceptedForSending: true;
}

const HARD_MAX_RESULTS = 100;
const HARD_MAX_BODY_CHARS = 1_000_000;
const HARD_MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const HARD_MAX_TIMEOUT_MS = 120_000;
const MAX_SEARCH_TIME_BUDGET_MS = 12_000;

function boundedInteger(
  value: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new MailBridgeError(
      "INVALID_REQUEST",
      `${name} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}

function searchTimeBudget(timeoutMs: number): number {
  const margin = Math.max(1, Math.floor(timeoutMs / 5));
  return Math.max(1, Math.min(MAX_SEARCH_TIME_BUDGET_MS, timeoutMs - margin));
}

function optionalText(value: string | undefined, name: string, maximum = 4_096): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maximum || trimmed.includes("\0")) {
    throw new MailBridgeError("INVALID_REQUEST", `${name} is invalid.`);
  }
  return trimmed;
}

function requiredText(value: string, name: string, maximum = 200_000): string {
  if (typeof value !== "string" || value.length > maximum || value.includes("\0")) {
    throw new MailBridgeError("INVALID_REQUEST", `${name} is invalid.`);
  }
  return value;
}

function requiredNonBlankText(value: string, name: string, maximum = 200_000): string {
  const text = requiredText(value, name, maximum);
  if (!text.trim()) {
    throw new MailBridgeError("INVALID_REQUEST", `${name} must not be empty.`);
  }
  return text;
}

function normalizedEmail(value: string, name = "Email address"): string {
  const email = optionalText(value, name, 320)?.toLowerCase();
  if (!email || !/^[^\s<>@]+@[^\s<>@]+$/.test(email)) {
    throw new MailBridgeError("INVALID_REQUEST", `${name} is invalid.`);
  }
  return email;
}

function normalizeAddressList(values: string[] | undefined, name: string): string[] {
  if (values === undefined) return [];
  if (!Array.isArray(values) || values.length > 100) {
    throw new MailBridgeError("INVALID_REQUEST", `${name} contains too many recipients.`);
  }
  return values.map((address) => normalizedEmail(address, `${name} address`));
}

function isoDate(value: string | undefined, name: string): string | undefined {
  if (value === undefined) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new MailBridgeError("INVALID_REQUEST", `${name} must be a valid date.`);
  }
  return date.toISOString();
}

function accountId(locator: AccountLocator): string {
  return encodeMailId("account", { accountKey: locator.accountKey });
}

function mailboxId(locator: MailboxLocator): string {
  return encodeMailId("mailbox", { accountKey: locator.accountKey, path: locator.path });
}

function messageId(locator: MessageLocator): string {
  return encodeMailId("message", {
    accountKey: locator.accountKey,
    path: locator.path,
    messageKey: locator.messageKey,
  });
}

function mapMailbox(raw: RawMailbox): Mailbox {
  const result: Mailbox = {
    id: mailboxId(raw),
    accountId: accountId(raw),
    name: raw.name,
    path: raw.path,
    unreadCount: raw.unreadCount,
  };
  if (raw.path.length > 1) {
    result.parentId = mailboxId({ accountKey: raw.accountKey, path: raw.path.slice(0, -1) });
  }
  return result;
}

function mapMessage(raw: RawMessageSummary): MessageSummary {
  return {
    id: messageId(raw),
    ...(raw.rfcMessageId ? { rfcMessageId: raw.rfcMessageId } : {}),
    accountId: accountId(raw),
    mailboxId: mailboxId(raw),
    subject: raw.subject,
    sender: raw.sender,
    ...(raw.dateReceived ? { dateReceived: raw.dateReceived } : {}),
    ...(raw.dateSent ? { dateSent: raw.dateSent } : {}),
    read: raw.read,
    flagged: raw.flagged,
    ...(raw.sizeBytes === undefined ? {} : { sizeBytes: raw.sizeBytes }),
  };
}

function mapAttachment(raw: RawAttachment): AttachmentMetadata {
  const publicMessageId = messageId(raw);
  return {
    id: encodeMailId("attachment", {
      accountKey: raw.accountKey,
      path: raw.path,
      messageKey: raw.messageKey,
      attachmentKey: raw.attachmentKey,
    }),
    messageId: publicMessageId,
    filename: raw.filename,
    mimeType: raw.mimeType,
    sizeBytes: raw.sizeBytes,
    downloaded: raw.downloaded,
  };
}

/** Typed Mail.app adapter. The injected runner makes all bridge behavior unit-testable. */
export class AppleMailBridge implements MailBridge {
  readonly allowedAccounts: string[];
  readonly maxBodyChars: number;
  readonly maxResults: number;
  readonly maxAttachmentBytes: number;
  readonly timeoutMs: number;
  readonly searchTimeBudgetMs: number;
  readonly runner: AutomationRunner;

  constructor(options: AppleMailBridgeOptions) {
    this.allowedAccounts = [...new Set((options.allowedAccounts ?? []).map((item) => normalizedEmail(item)))];
    this.maxBodyChars = boundedInteger(options.maxBodyChars, "maxBodyChars", 1, HARD_MAX_BODY_CHARS);
    this.maxResults = boundedInteger(options.maxResults ?? HARD_MAX_RESULTS, "maxResults", 1, HARD_MAX_RESULTS);
    this.maxAttachmentBytes = boundedInteger(
      options.maxAttachmentBytes ?? 5 * 1024 * 1024,
      "maxAttachmentBytes",
      1,
      HARD_MAX_ATTACHMENT_BYTES,
    );
    this.timeoutMs = boundedInteger(options.timeoutMs, "timeoutMs", 1, HARD_MAX_TIMEOUT_MS);
    this.searchTimeBudgetMs = searchTimeBudget(this.timeoutMs);
    this.runner = options.runner ?? new OsascriptAutomationRunner({ timeoutMs: this.timeoutMs });
  }

  private request<T>(operation: AutomationRequest["operation"], input: Record<string, unknown>): Promise<T> {
    return this.runner.run<T>({
      operation,
      input,
      policy: {
        allowedAccounts: this.allowedAccounts,
        maxBodyChars: this.maxBodyChars,
        maxAttachmentBytes: this.maxAttachmentBytes,
        maxResults: this.maxResults,
        searchTimeBudgetMs: this.searchTimeBudgetMs,
      },
    });
  }

  async listAccounts(): Promise<MailAccount[]> {
    const accounts = await this.request<RawAccount[]>("listAccounts", {});
    return accounts
      .filter(
        (raw) =>
          this.allowedAccounts.length === 0 ||
          raw.emailAddresses.some((email) => this.allowedAccounts.includes(email.toLowerCase())),
      )
      .map((raw) => ({
        id: accountId(raw),
        name: raw.name,
        emailAddresses: raw.emailAddresses,
        ...(raw.fullName ? { fullName: raw.fullName } : {}),
        enabled: raw.enabled,
      }));
  }

  async listMailboxes(input: ListMailboxesInput = {}): Promise<Mailbox[]> {
    const account = input.accountId ? decodeMailId("account", input.accountId) : undefined;
    const raw = await this.request<RawMailbox[]>("listMailboxes", {
      ...(account ? { account } : {}),
      includeNested: input.includeNested ?? true,
    });
    return raw.map(mapMailbox);
  }

  async searchMessages(input: SearchMessagesInput): Promise<SearchMessagesResult> {
    const account = input.accountId ? decodeMailId("account", input.accountId) : undefined;
    const mailbox = input.mailboxId ? decodeMailId("mailbox", input.mailboxId) : undefined;
    if (account && mailbox && account.accountKey !== mailbox.accountKey) {
      throw new MailBridgeError("INVALID_REQUEST", "The account and mailbox identifiers do not match.");
    }
    const limit = boundedInteger(input.limit ?? Math.min(25, this.maxResults), "limit", 1, this.maxResults);
    const raw = await this.request<RawSearchMessagesResult>("searchMessages", {
      ...(account ? { account } : {}),
      ...(mailbox ? { mailbox } : {}),
      scope: input.scope ?? "inbox",
      query: optionalText(input.query, "query"),
      from: optionalText(input.from, "from", 320),
      to: optionalText(input.to, "to", 320),
      subject: optionalText(input.subject, "subject"),
      dateFrom: isoDate(input.dateFrom, "dateFrom"),
      dateTo: isoDate(input.dateTo, "dateTo"),
      unread: input.unread,
      flagged: input.flagged,
      limit,
    });
    return {
      messages: raw.messages.map(mapMessage),
      scannedCount: raw.scannedCount,
      incomplete: raw.incomplete,
    };
  }

  async getMessage(input: GetMessageInput): Promise<FullMessage> {
    const locator = decodeMailId("message", input.messageId);
    const maxBodyChars = boundedInteger(
      input.maxBodyChars ?? this.maxBodyChars,
      "maxBodyChars",
      1,
      this.maxBodyChars,
    );
    const raw = await this.request<RawFullMessage>("getMessage", { message: locator, maxBodyChars });
    return {
      ...mapMessage(raw),
      body: raw.body,
      bodyTruncated: raw.bodyTruncated,
      originalBodyChars: raw.originalBodyChars,
      ...(raw.replyTo ? { replyTo: raw.replyTo } : {}),
      headers: raw.headers,
      recipients: raw.recipients,
      attachments: raw.attachments.map(mapAttachment),
    };
  }

  async getMessages(input: GetMessagesInput): Promise<FullMessage[]> {
    const limit = Math.min(25, this.maxResults);
    if (input.messageIds.length === 0 || input.messageIds.length > limit) {
      throw new MailBridgeError("INVALID_REQUEST", `messageIds must contain between 1 and ${limit} entries.`);
    }
    const locators = input.messageIds.map((messageId) => decodeMailId("message", messageId));
    const maxBodyChars = boundedInteger(
      input.maxBodyChars ?? this.maxBodyChars,
      "maxBodyChars",
      1,
      this.maxBodyChars,
    );
    const raw = await this.request<RawFullMessage[]>("getMessages", {
      messages: locators,
      maxBodyChars,
    });
    return raw.map((message) => ({
      ...mapMessage(message),
      body: message.body,
      bodyTruncated: message.bodyTruncated,
      originalBodyChars: message.originalBodyChars,
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      headers: message.headers,
      recipients: message.recipients,
      attachments: message.attachments.map(mapAttachment),
    }));
  }

  async getAttachment(input: GetAttachmentInput): Promise<AttachmentContent> {
    const locator = decodeMailId("attachment", input.attachmentId);
    const maxBytes = boundedInteger(
      input.maxBytes ?? this.maxAttachmentBytes,
      "maxBytes",
      1,
      this.maxAttachmentBytes,
    );
    const raw = await this.request<RawAttachmentContent>("getAttachment", {
      attachment: locator,
      maxBytes,
    });
    return {
      ...mapAttachment(raw),
      encoding: "base64",
      content: raw.content,
      truncated: false,
    };
  }

  async setMessageState(input: SetMessageStateInput): Promise<MessageSummary> {
    const message = decodeMailId("message", input.messageId);
    if (input.read === undefined && input.flagged === undefined) {
      throw new MailBridgeError("INVALID_REQUEST", "At least one message state must be supplied.");
    }
    if (input.read !== undefined && typeof input.read !== "boolean") {
      throw new MailBridgeError("INVALID_REQUEST", "read must be a boolean.");
    }
    if (input.flagged !== undefined && typeof input.flagged !== "boolean") {
      throw new MailBridgeError("INVALID_REQUEST", "flagged must be a boolean.");
    }
    const raw = await this.request<RawMessageSummary>("setMessageState", {
      message,
      read: input.read,
      flagged: input.flagged,
    });
    return mapMessage(raw);
  }

  async createDraft(input: CreateDraftInput): Promise<DraftResult> {
    const account = decodeMailId("account", input.accountId);
    const from = this.validateSender(input.from);
    const to = normalizeAddressList(input.to, "to");
    if (to.length === 0) {
      throw new MailBridgeError("INVALID_REQUEST", "A draft requires at least one To recipient.");
    }
    const raw = await this.request<RawDraftResult>("createDraft", {
      account,
      from,
      to,
      cc: normalizeAddressList(input.cc, "cc"),
      bcc: normalizeAddressList(input.bcc, "bcc"),
      subject: requiredText(input.subject, "subject", 998),
      body: requiredText(input.body, "body"),
    });
    return this.mapDraft(raw);
  }

  async createReplyDraft(input: CreateReplyDraftInput): Promise<DraftResult> {
    const message = decodeMailId("message", input.messageId);
    const raw = await this.request<RawDraftResult>("createReplyDraft", {
      message,
      from: this.validateSender(input.from),
      replyAll: input.replyAll ?? false,
      ...(input.body === undefined ? {} : { body: requiredText(input.body, "body") }),
    });
    return this.mapDraft(raw);
  }

  async createForwardDraft(input: CreateForwardDraftInput): Promise<DraftResult> {
    const message = decodeMailId("message", input.messageId);
    const to = normalizeAddressList(input.to, "to");
    if (to.length === 0) {
      throw new MailBridgeError("INVALID_REQUEST", "A forward draft requires at least one To recipient.");
    }
    const raw = await this.request<RawDraftResult>("createForwardDraft", {
      message,
      from: this.validateSender(input.from),
      to,
      cc: normalizeAddressList(input.cc, "cc"),
      bcc: normalizeAddressList(input.bcc, "bcc"),
      ...(input.body === undefined ? {} : { body: requiredText(input.body, "body") }),
    });
    return this.mapDraft(raw);
  }

  async sendMessage(input: SendMessageInput): Promise<SendResult> {
    if (input.confirmed !== true) {
      throw new MailBridgeError("INVALID_REQUEST", "Sending requires explicit confirmation.");
    }
    if (this.allowedAccounts.length === 0) {
      throw new MailBridgeError("INVALID_REQUEST", "Sending requires an explicit account allowlist.");
    }
    const account = decodeMailId("account", input.accountId);
    const from = this.validateSender(input.from);
    const to = normalizeAddressList(input.to, "to");
    if (to.length === 0) {
      throw new MailBridgeError("INVALID_REQUEST", "A message requires at least one To recipient.");
    }
    const raw = await this.request<RawSendResult>("sendMessage", {
      account,
      from,
      to,
      cc: normalizeAddressList(input.cc, "cc"),
      bcc: normalizeAddressList(input.bcc, "bcc"),
      subject: requiredText(input.subject, "subject", 998),
      body: requiredNonBlankText(input.body, "body"),
      confirmed: true,
    });
    return this.mapSend(raw);
  }

  async sendReply(input: SendReplyInput): Promise<SendResult> {
    if (input.confirmed !== true) {
      throw new MailBridgeError("INVALID_REQUEST", "Sending requires explicit confirmation.");
    }
    if (this.allowedAccounts.length === 0) {
      throw new MailBridgeError("INVALID_REQUEST", "Sending requires an explicit account allowlist.");
    }
    const message = decodeMailId("message", input.messageId);
    const expectedTo = normalizeAddressList(input.expectedTo, "expectedTo");
    if (expectedTo.length === 0) {
      throw new MailBridgeError("INVALID_REQUEST", "A reply requires at least one expected To recipient.");
    }
    const raw = await this.request<RawSendResult>("sendReply", {
      message,
      from: this.validateSender(input.from),
      expectedTo,
      expectedCc: normalizeAddressList(input.expectedCc, "expectedCc"),
      expectedBcc: normalizeAddressList(input.expectedBcc, "expectedBcc"),
      replyAll: input.replyAll ?? false,
      body: requiredNonBlankText(input.body, "body"),
      confirmed: true,
    });
    return this.mapSend(raw);
  }

  private validateSender(value: string): string {
    const sender = normalizedEmail(value, "from");
    if (this.allowedAccounts.length > 0 && !this.allowedAccounts.includes(sender)) {
      throw new MailBridgeError("ACCOUNT_NOT_ALLOWED", "The sender account is not allowed.");
    }
    return sender;
  }

  private mapDraft(raw: RawDraftResult): DraftResult {
    return {
      id: encodeMailId("draft", {
        accountKey: raw.accountKey,
        draftKey: raw.draftKey,
        sender: raw.sender,
      }),
      accountId: accountId(raw),
      from: raw.sender,
      subject: raw.subject,
      sent: raw.sent,
    };
  }

  private mapSend(raw: RawSendResult): SendResult {
    if (raw.acceptedForSending !== true) {
      throw new MailBridgeError("SEND_REJECTED", "Mail.app did not accept the message for sending.");
    }
    return {
      accountId: accountId(raw),
      from: raw.sender,
      subject: raw.subject,
      recipients: raw.recipients,
      acceptedForSending: true,
    };
  }
}

export function createMailBridge(options: AppleMailBridgeOptions): MailBridge {
  return new AppleMailBridge(options);
}
