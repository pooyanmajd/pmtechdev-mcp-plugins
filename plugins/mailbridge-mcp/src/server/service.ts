import { randomUUID } from "node:crypto";

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
import { outboundPreviewCard, type OutboundPreview } from "./outbound-preview.js";
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
  mailbridgeCommitAccessPreferencesInputSchema,
  mailbridgeSetAccessPreferencesInputSchema,
  previewOutboundInputSchema,
  searchMessagesInputSchema,
  sendMessageInputSchema,
  sendReplyInputSchema,
  setMessageStateInputSchema,
  type ToolName,
} from "./schemas.js";

type StructuredJson = Record<string, unknown>;
const MAX_CONCURRENT_OR_QUEUED_AUTOMATIONS = 2;
const MAX_CONCURRENT_OR_QUEUED_CONFIRMATIONS = 2;
const MAX_ACCESS_PROPOSALS = 6;
const ACCESS_PROPOSAL_TTL_MS = 10 * 60 * 1_000;

export type MailSendConfirmation = OutboundPreview;

export type ConfirmMailSend = (confirmation: MailSendConfirmation) => Promise<boolean>;

export type AccessPreferencesVerification =
  | { readonly performed: true; readonly matchedAccounts: readonly string[]; readonly unmatchedAccounts: readonly string[] }
  | { readonly performed: false; readonly reason: string };

export interface AccessPreferencesProposal {
  readonly status: "awaiting-user";
  readonly activeMode: MailbridgeConfig["mode"];
  readonly activeAllowedAccounts: readonly string[] | undefined;
  readonly savedMode: MailbridgeConfig["mode"] | undefined;
  readonly savedAllowedAccounts: readonly string[] | undefined;
  readonly savedPreferencesDiagnostic: string | undefined;
  readonly proposedMode: Exclude<MailbridgeConfig["mode"], "send">;
  readonly proposedAllowedAccounts: readonly string[];
  readonly verification: AccessPreferencesVerification;
  readonly shadowedByEnvironment: LocalPreferencesContext["envOverrides"];
}

interface PendingAccessPreferencesProposal {
  readonly id: string;
  readonly createdAtMs: number;
  readonly proposal: AccessPreferencesProposal;
  committedResult?: SetAccessPreferencesResult;
}

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

function success(data: unknown, meta?: Record<string, unknown>): CallToolResult {
  const structuredContent: StructuredJson = { ok: true, data };
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent,
    ...(meta === undefined ? {} : { _meta: meta }),
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
  // Separate from automationQueue: bounds concurrent pending client confirmations
  // (which can each wait minutes on a human) independently of Mail.app/JXA calls,
  // so neither can starve the other.
  private readonly confirmationQueue = new BoundedSerialQueue(MAX_CONCURRENT_OR_QUEUED_CONFIRMATIONS);
  private readonly preferencesQueue = new BoundedSerialQueue(MAX_CONCURRENT_OR_QUEUED_CONFIRMATIONS);
  private readonly accessProposals = new Map<string, PendingAccessPreferencesProposal>();

  public constructor(
    private readonly bridge: MailBridge,
    private readonly config: MailbridgeConfig,
    private readonly confirmMailSend?: ConfirmMailSend,
    private readonly localPreferences: LocalPreferencesContext = defaultLocalPreferencesContext(),
  ) {}

  public async invoke(name: ToolName, rawInput: unknown): Promise<CallToolResult> {
    try {
      if (name === "mailbridge_set_access_preferences") {
        const prepared = await this.prepareAccessPreferences(rawInput);
        return success(prepared.proposal, {
          "mailbridge/accessProposal": { proposalId: prepared.proposalId },
        });
      }
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

  private async resolveSearchAccountScope(
    accountId: string | undefined,
    mailboxId: string | undefined,
  ): Promise<string | undefined> {
    if (
      accountId !== undefined ||
      mailboxId !== undefined ||
      this.config.allowedAccounts !== undefined
    ) {
      return accountId;
    }
    const accounts = await this.runAutomation(async () => this.bridge.listAccounts());
    if (accounts.length > 1) {
      throw new MailbridgeError("ACCOUNT_SCOPE_REQUIRED");
    }
    return accounts[0]?.id;
  }

  private async confirmPromptedSend(confirmation: MailSendConfirmation): Promise<void> {
    if (this.confirmMailSend === undefined) {
      throw new MailbridgeError("CONFIRMATION_UNAVAILABLE");
    }
    const confirmMailSend = this.confirmMailSend;

    let approved: boolean;
    try {
      approved = await this.confirmationQueue.run(
        () => confirmMailSend(confirmation),
        () => new MailbridgeError("CONFIRMATION_BUSY"),
      );
    } catch (error: unknown) {
      if (error instanceof MailbridgeError && error.code === "CONFIRMATION_BUSY") {
        throw error;
      }
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

  private pruneAccessProposals(nowMs: number): void {
    for (const [id, pending] of this.accessProposals) {
      if (nowMs - pending.createdAtMs >= ACCESS_PROPOSAL_TTL_MS) {
        this.accessProposals.delete(id);
      }
    }
  }

  private async prepareAccessPreferences(rawInput: unknown): Promise<{
    readonly proposalId: string;
    readonly proposal: AccessPreferencesProposal;
  }> {
    const input = parseInput(mailbridgeSetAccessPreferencesInputSchema, rawInput);
    const proposedAccounts = [...new Set(input.allowedAccounts.map((account) => account.trim().toLowerCase()))];
    const {
      preferences: savedPreferences,
      diagnostic: savedPreferencesDiagnostic,
    } = await readLocalPreferences(this.localPreferences.path);

    let verification: AccessPreferencesVerification;
    try {
      const accounts = await this.runAutomation(async () => this.bridge.listAccounts());
      const known = new Set(
        accounts.flatMap((account) => account.emailAddresses.map((address) => address.toLowerCase())),
      );
      verification = {
        performed: true,
        matchedAccounts: proposedAccounts.filter((address) => known.has(address)),
        unmatchedAccounts: proposedAccounts.filter((address) => !known.has(address)),
      };
    } catch {
      verification = {
        performed: false,
        reason: "Could not verify the proposed addresses against live Mail.app accounts; the card will show this before saving.",
      };
    }

    const proposal: AccessPreferencesProposal = {
      status: "awaiting-user",
      activeMode: this.config.mode,
      activeAllowedAccounts: this.config.allowedAccounts,
      savedMode: savedPreferences?.mode,
      savedAllowedAccounts: savedPreferences?.allowedAccounts,
      savedPreferencesDiagnostic,
      proposedMode: input.mode,
      proposedAllowedAccounts: proposedAccounts,
      verification,
      shadowedByEnvironment: this.localPreferences.envOverrides,
    };
    const proposalId = randomUUID();
    const nowMs = Date.now();
    this.pruneAccessProposals(nowMs);
    // Make room only when inserting. A commit must not evict a valid proposal
    // just because the store is currently at capacity.
    while (this.accessProposals.size >= MAX_ACCESS_PROPOSALS) {
      const oldestId = this.accessProposals.keys().next().value;
      if (oldestId === undefined) break;
      this.accessProposals.delete(oldestId);
    }
    this.accessProposals.set(proposalId, { id: proposalId, createdAtMs: nowMs, proposal });
    return { proposalId, proposal };
  }

  private async commitAccessPreferences(rawInput: unknown): Promise<SetAccessPreferencesResult> {
    const input = parseInput(mailbridgeCommitAccessPreferencesInputSchema, rawInput);
    return this.preferencesQueue.run(async () => {
      const nowMs = Date.now();
      this.pruneAccessProposals(nowMs);
      const pending = this.accessProposals.get(input.proposalId);
      if (pending === undefined) {
        throw new MailbridgeError("PREFERENCES_PROPOSAL_EXPIRED");
      }
      if (pending.committedResult !== undefined) {
        return pending.committedResult;
      }

      let saved;
      try {
        saved = await writeLocalPreferences(this.localPreferences.path, {
          mode: pending.proposal.proposedMode,
          allowedAccounts: pending.proposal.proposedAllowedAccounts,
        });
      } catch {
        throw new MailbridgeError("LOCAL_PREFERENCES_WRITE_FAILED");
      }

      const result: SetAccessPreferencesResult = {
        saved: true,
        path: this.localPreferences.path,
        mode: saved.mode,
        allowedAccounts: saved.allowedAccounts,
        verification: pending.proposal.verification,
        effectiveImmediately: false,
        appliesAfter: "restart-or-reconnect",
        shadowedByEnvironment: this.localPreferences.envOverrides,
      };
      pending.committedResult = result;
      return result;
    }, () => new MailbridgeError("CONFIRMATION_BUSY"));
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
        const accountId = await this.resolveSearchAccountScope(input.accountId, input.mailboxId);
        const limit = Math.min(input.limit ?? this.config.maxResults, this.config.maxResults);
        return this.runAutomation(async () =>
          this.bridge.searchMessages({
            ...(input.query === undefined ? {} : { query: input.query }),
            ...(accountId === undefined ? {} : { accountId }),
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
      case "mail_preview_outbound": {
        const input = parseInput(previewOutboundInputSchema, rawInput);
        if (input.kind === "message") {
          return outboundPreviewCard({
            kind: "message",
            from: input.from,
            to: input.to,
            cc: input.cc,
            bcc: input.bcc,
            subject: input.subject,
            body: input.body,
          });
        }
        const source = await this.runAutomation(async () =>
          this.bridge.getMessage({
            messageId: input.messageId,
            maxBodyChars: 1,
          }),
        );
        return outboundPreviewCard({
          kind: "reply",
          from: input.from,
          to: input.expectedTo,
          cc: input.expectedCc,
          bcc: input.expectedBcc,
          sourceSubject: typeof source.subject === "string" ? source.subject : "",
          replyAll: input.replyAll,
          body: input.body,
        });
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
        // Handled in invoke() so the short-lived proposal identifier can be
        // returned through result _meta, which is visible to the card but not
        // to the model.
        throw new MailbridgeError("INVALID_INPUT");
      }
      case "mailbridge_commit_access_preferences": {
        return this.commitAccessPreferences(rawInput);
      }
    }
  }
}
