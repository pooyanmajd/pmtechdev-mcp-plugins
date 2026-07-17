import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import { BoundedSerialQueue } from "@pmtechdev/mcp-kit";

import type { MailbridgeConfig } from "../config.js";
import { MailbridgeError, toPublicError } from "../errors.js";
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
  searchMessagesInputSchema,
  setMessageStateInputSchema,
  type ToolName,
} from "./schemas.js";

type StructuredJson = Record<string, unknown>;
const MAX_CONCURRENT_OR_QUEUED_AUTOMATIONS = 2;

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
  ) {}

  public async invoke(name: ToolName, rawInput: unknown): Promise<CallToolResult> {
    try {
      return await this.automationQueue.run(
        async () => success(await this.execute(name, rawInput)),
        () => new MailbridgeError("AUTOMATION_BUSY"),
      );
    } catch (error: unknown) {
      return failure(error);
    }
  }

  private requireDraftsMode(): void {
    if (this.config.mode === "read-only") {
      throw new MailbridgeError("READ_ONLY");
    }
  }

  private requireFullMode(): void {
    if (this.config.mode !== "full") {
      throw new MailbridgeError("READ_ONLY");
    }
  }

  private async runMutation<T>(operation: () => Promise<T>): Promise<T> {
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
  }

  private async execute(name: ToolName, rawInput: unknown): Promise<unknown> {
    switch (name) {
      case "mail_list_accounts": {
        parseInput(listAccountsInputSchema, rawInput);
        return this.bridge.listAccounts();
      }
      case "mail_list_mailboxes": {
        const input = parseInput(listMailboxesInputSchema, rawInput);
        return this.bridge.listMailboxes({
          ...(input.accountId === undefined ? {} : { accountId: input.accountId }),
          includeNested: input.includeNested,
        });
      }
      case "mail_search_messages": {
        const input = parseInput(searchMessagesInputSchema, rawInput);
        const limit = Math.min(input.limit ?? this.config.maxResults, this.config.maxResults);
        return this.bridge.searchMessages({
          ...(input.query === undefined ? {} : { query: input.query }),
          ...(input.accountId === undefined ? {} : { accountId: input.accountId }),
          ...(input.mailboxId === undefined ? {} : { mailboxId: input.mailboxId }),
          scope: input.scope,
          ...(input.from === undefined ? {} : { from: input.from }),
          ...(input.to === undefined ? {} : { to: input.to }),
          ...(input.subject === undefined ? {} : { subject: input.subject }),
          ...(input.since === undefined ? {} : { dateFrom: input.since }),
          ...(input.before === undefined ? {} : { dateTo: input.before }),
          unread: input.unreadOnly,
          flagged: input.flaggedOnly,
          limit,
        });
      }
      case "mail_get_message": {
        const input = parseInput(getMessageInputSchema, rawInput);
        return this.bridge.getMessage({
          messageId: input.messageId,
          maxBodyChars: Math.min(input.maxBodyChars ?? this.config.maxBodyChars, this.config.maxBodyChars),
        });
      }
      case "mail_get_messages": {
        const input = parseInput(getMessagesInputSchema, rawInput);
        return this.bridge.getMessages({
          messageIds: input.messageIds,
          maxBodyChars: Math.min(input.maxBodyChars ?? this.config.maxBodyChars, this.config.maxBodyChars),
        });
      }
      case "mail_get_attachment": {
        const input = parseInput(getAttachmentInputSchema, rawInput);
        return this.bridge.getAttachment(input);
      }
      case "mail_set_message_state": {
        this.requireFullMode();
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
    }
  }
}
