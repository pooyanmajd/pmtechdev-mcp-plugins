import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import { BoundedSerialQueue } from "@pmtechdev/mcp-kit";

import type { MailbridgeConfig } from "../config.js";
import { MailbridgeError, toPublicError } from "../errors.js";
import {
  defaultLocalPreferencesContext,
  readLocalPreferences,
  writeLocalPreferences,
  type LocalPreferencesContext,
} from "../local-config.js";
import type { MailBridge } from "../mail/bridge.js";
import {
  createDraftInputSchema,
  createForwardDraftInputSchema,
  createReplyDraftInputSchema,
  getAttachmentInputSchema,
  getMessageInputSchema,
  getMessagesInputSchema,
  listAccountsInputSchema,
  listMailboxesInputSchema,
  mailbridgeGetAccessPreferencesInputSchema,
  mailbridgeSetAccessPreferencesInputSchema,
  searchMessagesInputSchema,
  sendMessageInputSchema,
  sendReplyInputSchema,
  setMessageStateInputSchema,
  type ToolName,
} from "./schemas.js";

type StructuredJson = Record<string, unknown>;
const MAX_CONCURRENT_OR_QUEUED_AUTOMATIONS = 2;

export type MailSendConfirmation =
  | {
      readonly kind: "message";
      readonly from: string;
      readonly to: readonly string[];
      readonly cc: readonly string[];
      readonly bcc: readonly string[];
      readonly subject: string;
      readonly body: string;
    }
  | {
      readonly kind: "reply";
      readonly from: string;
      readonly to: readonly string[];
      readonly cc: readonly string[];
      readonly bcc: readonly string[];
      readonly sourceSubject: string;
      readonly replyAll: boolean;
      readonly body: string;
    };

export type ConfirmMailSend = (confirmation: MailSendConfirmation) => Promise<boolean>;

type AccessPreferencesVerification =
  | { readonly performed: true; readonly matchedAccounts: readonly string[]; readonly unmatchedAccounts: readonly string[] }
  | { readonly performed: false; readonly reason: string };

interface GetAccessPreferencesResult {
  readonly found: boolean;
  readonly path: string;
  readonly savedMode?: MailbridgeConfig["mode"];
  readonly savedAllowedAccounts?: readonly string[];
  readonly updatedAt?: string;
  readonly diagnostic?: string;
  readonly activeMode: MailbridgeConfig["mode"];
  readonly activeAllowedAccounts: readonly string[] | undefined;
  readonly shadowedByEnvironment: LocalPreferencesContext["envOverrides"];
}

interface SetAccessPreferencesResult {
  readonly saved: true;
  readonly path: string;
  readonly mode: MailbridgeConfig["mode"];
  readonly allowedAccounts: readonly string[];
  readonly verification: AccessPreferencesVerification;
  readonly effectiveImmediately: false;
  readonly appliesAfter: "restart-or-reconnect";
  readonly shadowedByEnvironment: LocalPreferencesContext["envOverrides"];
}

function success(data: unknown): CallToolResult {
  const structuredContent: StructuredJson = { ok: true, data };
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}

function failure(error: unknown): CallToolResult {
  const publicError = toPublicError(error);
  const structuredContent: StructuredJson = {
    ok: false,
    error: {
      code: publicError.code,
      message: publicError.message,
    },
  };

  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent,
    isError: true,
  };
}

function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new MailbridgeError("INVALID_INPUT");
  }
  return parsed.data;
}

export class MailbridgeToolService {
  private readonly automationQueue = new BoundedSerialQueue(MAX_CONCURRENT_OR_QUEUED_AUTOMATIONS);

  public constructor(
    private readonly bridge: MailBridge,
    private readonly config: MailbridgeConfig,
    private readonly confirmMailSend?: ConfirmMailSend,
    private readonly localPreferences: LocalPreferencesContext = defaultLocalPreferencesContext(),
  ) {}

  public async invoke(name: ToolName, rawInput: unknown): Promise<CallToolResult> {
    try {
      return success(await this.execute(name, rawInput));
    } catch (error: unknown) {
      return failure(error);
    }
  }

  private requireDraftsMode(): void {
    if (this.config.mode === "read-only") {
      throw new MailbridgeError("READ_ONLY");
    }
  }

  private requireStateChangeMode(): void {
    if (this.config.mode !== "full" && this.config.mode !== "prompted" && this.config.mode !== "send") {
      throw new MailbridgeError("READ_ONLY");
    }
  }

  private sendAuthorization(): "allowlisted" | "prompted" {
    if (this.config.mode === "send") return "allowlisted";
    if (this.config.mode === "prompted") return "prompted";
    throw new MailbridgeError("READ_ONLY");
  }

  private async confirmPromptedSend(confirmation: MailSendConfirmation): Promise<void> {
    if (this.confirmMailSend === undefined) {
      throw new MailbridgeError("CONFIRMATION_UNAVAILABLE");
    }

    let approved: boolean;
    try {
      approved = await this.confirmMailSend(confirmation);
    } catch {
      throw new MailbridgeError("CONFIRMATION_UNAVAILABLE");
    }
    if (!approved) {
      throw new MailbridgeError("SEND_NOT_CONFIRMED");
    }
  }

  /**
   * Acquires the bounded automation queue slot around one actual Mail.app/JXA
   * call. Only bridge-touching operations go through here — mode/authorization
   * checks and the confirmPromptedSend() elicitation wait must run before this
   * (see execute()'s send cases), or a pending confirmation would occupy one of
   * only two queue slots for as long as a human takes to respond.
   */
  private async runAutomation<T>(operation: () => Promise<T>): Promise<T> {
    return this.automationQueue.run(operation, () => new MailbridgeError("AUTOMATION_BUSY"));
  }

  private async runMutation<T>(operation: () => Promise<T>): Promise<T> {
    return this.runAutomation(async () => {
      try {
        return await operation();
      } catch (error: unknown) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "TIMEOUT"
        ) {
          throw new MailbridgeError("MUTATION_OUTCOME_UNKNOWN");
        }
        throw error;
      }
    });
  }

  private async execute(name: ToolName, rawInput: unknown): Promise<unknown> {
    switch (name) {
      case "mail_list_accounts": {
        parseInput(listAccountsInputSchema, rawInput);
        return this.runAutomation(async () => this.bridge.listAccounts());
      }
      case "mail_list_mailboxes": {
        const input = parseInput(listMailboxesInputSchema, rawInput);
        return this.runAutomation(async () =>
          this.bridge.listMailboxes({
            ...(input.accountId === undefined ? {} : { accountId: input.accountId }),
            includeNested: input.includeNested,
          }),
        );
      }
      case "mail_search_messages": {
        const input = parseInput(searchMessagesInputSchema, rawInput);
        const limit = Math.min(input.limit ?? this.config.maxResults, this.config.maxResults);
        return this.runAutomation(async () =>
          this.bridge.searchMessages({
            ...(input.query === undefined ? {} : { query: input.query }),
            ...(input.accountId === undefined ? {} : { accountId: input.accountId }),
            ...(input.mailboxId === undefined ? {} : { mailboxId: input.mailboxId }),
            scope: input.scope,
            ...(input.from === undefined ? {} : { from: input.from }),
            ...(input.to === undefined ? {} : { to: input.to }),
            ...(input.subject === undefined ? {} : { subject: input.subject }),
            subjectMatch: input.subjectMatch,
            ...(input.since === undefined ? {} : { dateFrom: input.since }),
            ...(input.before === undefined ? {} : { dateTo: input.before }),
            unread: input.unreadOnly,
            flagged: input.flaggedOnly,
            limit,
            ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
          }),
        );
      }
      case "mail_get_message": {
        const input = parseInput(getMessageInputSchema, rawInput);
        return this.runAutomation(async () =>
          this.bridge.getMessage({
            messageId: input.messageId,
            maxBodyChars: Math.min(input.maxBodyChars ?? this.config.maxBodyChars, this.config.maxBodyChars),
          }),
        );
      }
      case "mail_get_messages": {
        const input = parseInput(getMessagesInputSchema, rawInput);
        return this.runAutomation(async () =>
          this.bridge.getMessages({
            messageIds: input.messageIds,
            maxBodyChars: Math.min(input.maxBodyChars ?? this.config.maxBodyChars, this.config.maxBodyChars),
          }),
        );
      }
      case "mail_get_attachment": {
        const input = parseInput(getAttachmentInputSchema, rawInput);
        return this.runAutomation(async () => this.bridge.getAttachment(input));
      }
      case "mail_set_message_state": {
        this.requireStateChangeMode();
        const input = parseInput(setMessageStateInputSchema, rawInput);
        return this.runMutation(async () =>
          this.bridge.setMessageState({
            messageId: input.messageId,
            ...(input.read === undefined ? {} : { read: input.read }),
            ...(input.flagged === undefined ? {} : { flagged: input.flagged }),
          }),
        );
      }
      case "mail_create_draft": {
        this.requireDraftsMode();
        const input = parseInput(createDraftInputSchema, rawInput);
        return this.runMutation(async () => this.bridge.createDraft(input));
      }
      case "mail_create_reply_draft": {
        this.requireDraftsMode();
        const input = parseInput(createReplyDraftInputSchema, rawInput);
        return this.runMutation(async () => this.bridge.createReplyDraft(input));
      }
      case "mail_create_forward_draft": {
        this.requireDraftsMode();
        const input = parseInput(createForwardDraftInputSchema, rawInput);
        return this.runMutation(async () => this.bridge.createForwardDraft(input));
      }
      case "mail_send_message": {
        const authorization = this.sendAuthorization();
        const input = parseInput(sendMessageInputSchema, rawInput);
        if (authorization === "prompted") {
          await this.confirmPromptedSend({
            kind: "message",
            from: input.from,
            to: input.to,
            cc: input.cc,
            bcc: input.bcc,
            subject: input.subject,
            body: input.body,
          });
        }
        return this.runMutation(async () => this.bridge.sendMessage(input));
      }
      case "mail_send_reply": {
        const authorization = this.sendAuthorization();
        const input = parseInput(sendReplyInputSchema, rawInput);
        if (authorization === "prompted") {
          const source = await this.runAutomation(async () =>
            this.bridge.getMessage({
              messageId: input.messageId,
              maxBodyChars: 1,
            }),
          );
          await this.confirmPromptedSend({
            kind: "reply",
            from: input.from,
            to: input.expectedTo,
            cc: input.expectedCc,
            bcc: input.expectedBcc,
            sourceSubject: source.subject,
            replyAll: input.replyAll,
            body: input.body,
          });
        }
        return this.runMutation(async () => this.bridge.sendReply(input));
      }
      case "mailbridge_get_access_preferences": {
        parseInput(mailbridgeGetAccessPreferencesInputSchema, rawInput);
        const { preferences, diagnostic } = await readLocalPreferences(this.localPreferences.path);
        const result: GetAccessPreferencesResult = {
          found: preferences !== undefined,
          path: this.localPreferences.path,
          ...(preferences === undefined
            ? {}
            : {
                savedMode: preferences.mode,
                savedAllowedAccounts: preferences.allowedAccounts,
                updatedAt: preferences.updatedAt,
              }),
          ...(diagnostic === undefined ? {} : { diagnostic }),
          activeMode: this.config.mode,
          activeAllowedAccounts: this.config.allowedAccounts,
          shadowedByEnvironment: this.localPreferences.envOverrides,
        };
        return result;
      }
      case "mailbridge_set_access_preferences": {
        const input = parseInput(mailbridgeSetAccessPreferencesInputSchema, rawInput);
        const proposed = new Set(input.allowedAccounts.map((account) => account.trim().toLowerCase()));

        let verification: AccessPreferencesVerification;
        try {
          const accounts = await this.runAutomation(async () => this.bridge.listAccounts());
          const known = new Set(
            accounts.flatMap((account) => account.emailAddresses.map((address) => address.toLowerCase())),
          );
          verification = {
            performed: true,
            matchedAccounts: [...proposed].filter((address) => known.has(address)),
            unmatchedAccounts: [...proposed].filter((address) => !known.has(address)),
          };
        } catch {
          verification = {
            performed: false,
            reason: "Could not verify the proposed addresses against live Mail.app accounts; saved anyway.",
          };
        }

        let saved;
        try {
          saved = await writeLocalPreferences(this.localPreferences.path, {
            mode: input.mode,
            allowedAccounts: input.allowedAccounts,
          });
        } catch {
          throw new MailbridgeError("LOCAL_PREFERENCES_WRITE_FAILED");
        }

        const result: SetAccessPreferencesResult = {
          saved: true,
          path: this.localPreferences.path,
          mode: saved.mode,
          allowedAccounts: saved.allowedAccounts,
          verification,
          effectiveImmediately: false,
          appliesAfter: "restart-or-reconnect",
          shadowedByEnvironment: this.localPreferences.envOverrides,
        };
        return result;
      }
    }
  }
}
