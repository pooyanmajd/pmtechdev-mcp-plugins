import { z } from "zod";

const OPAQUE_ID_MAX_CHARS = 4_096;
const MAX_QUERY_CHARS = 2_000;
const MAX_SUBJECT_CHARS = 998;
const MAX_OUTGOING_BODY_CHARS = 200_000;
const MAX_RECIPIENTS_PER_FIELD = 50;
const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
const MAX_MESSAGE_BATCH = 25;

const opaqueId = z
  .string()
  .trim()
  .min(1, "An opaque identifier is required.")
  .max(OPAQUE_ID_MAX_CHARS, "The opaque identifier is too long.");

const emailAddress = z.string().trim().email().max(320);
const recipients = z.array(emailAddress).max(MAX_RECIPIENTS_PER_FIELD);

export const listAccountsInputSchema = z.object({}).strict();

export const listMailboxesInputSchema = z
  .object({
    accountId: opaqueId.optional().describe("Opaque account ID returned by mail_list_accounts."),
    includeNested: z.boolean().default(true).describe("Include nested mailboxes."),
  })
  .strict();

export const searchMessagesInputSchema = z
  .object({
    query: z.string().trim().min(1).max(MAX_QUERY_CHARS).optional().describe("Plain-text term matched against message metadata."),
    accountId: opaqueId.optional().describe("Optional opaque account ID returned by mail_list_accounts."),
    mailboxId: opaqueId.optional().describe("Optional opaque mailbox ID returned by mail_list_mailboxes."),
    scope: z.enum(["inbox", "all"]).default("inbox").describe("Mailbox scope when mailboxId is omitted. Defaults to inbox across allowed accounts."),
    from: z.string().trim().min(1).max(320).optional().describe("Sender address or text to match."),
    to: z.string().trim().min(1).max(320).optional().describe("Recipient address or text to match."),
    subject: z.string().trim().min(1).max(MAX_SUBJECT_CHARS).optional().describe("Subject text to match."),
    since: z.string().datetime({ offset: true }).optional().describe("Inclusive ISO 8601 received-date lower bound."),
    before: z.string().datetime({ offset: true }).optional().describe("Exclusive ISO 8601 received-date upper bound."),
    unreadOnly: z.boolean().default(false),
    flaggedOnly: z.boolean().default(false),
    limit: z.number().int().min(1).max(100).optional().describe("Maximum results; also capped by server configuration."),
  })
  .strict()
  .refine(
    ({ since, before }) => since === undefined || before === undefined || Date.parse(since) < Date.parse(before),
    { message: "since must be earlier than before.", path: ["before"] },
  );

export const getMessageInputSchema = z
  .object({
    messageId: opaqueId.describe("Opaque message ID returned by mail_search_messages."),
    maxBodyChars: z.number().int().min(1).max(1_000_000).optional().describe("Requested body character cap; the server cap still applies."),
  })
  .strict();

export const getMessagesInputSchema = z
  .object({
    messageIds: z.array(opaqueId).min(1).max(MAX_MESSAGE_BATCH).describe("Opaque message IDs returned by mail_search_messages."),
    maxBodyChars: z.number().int().min(1).max(1_000_000).optional().describe("Requested per-message body character cap; the server cap still applies."),
  })
  .strict();

export const getAttachmentInputSchema = z
  .object({
    attachmentId: opaqueId.describe("Opaque attachment ID returned by mail_get_message."),
    maxBytes: z.number().int().min(1).max(MAX_ATTACHMENT_BYTES).default(MAX_ATTACHMENT_BYTES),
  })
  .strict();

export const setMessageStateInputSchema = z
  .object({
    messageId: opaqueId.describe("Opaque message ID returned by mail_search_messages."),
    read: z.boolean().optional(),
    flagged: z.boolean().optional(),
  })
  .strict()
  .refine(({ read, flagged }) => read !== undefined || flagged !== undefined, {
    message: "At least one of read or flagged is required.",
  });

export const createDraftInputSchema = z
  .object({
    accountId: opaqueId.describe("Opaque account ID returned by mail_list_accounts."),
    from: emailAddress.describe("Sender address belonging to the selected and allowed account."),
    to: recipients.default([]),
    cc: recipients.default([]),
    bcc: recipients.default([]),
    subject: z.string().max(MAX_SUBJECT_CHARS).default(""),
    body: z.string().max(MAX_OUTGOING_BODY_CHARS).default(""),
  })
  .strict()
  .refine(({ to }) => to.length > 0, { message: "At least one To recipient is required.", path: ["to"] });

export const createReplyDraftInputSchema = z
  .object({
    messageId: opaqueId.describe("Opaque source message ID."),
    from: emailAddress.describe("Sender address belonging to an allowed account."),
    replyAll: z.boolean().default(false),
    body: z.string().max(MAX_OUTGOING_BODY_CHARS).default(""),
  })
  .strict();

export const createForwardDraftInputSchema = z
  .object({
    messageId: opaqueId.describe("Opaque source message ID."),
    from: emailAddress.describe("Sender address belonging to an allowed account."),
    to: recipients.default([]),
    cc: recipients.default([]),
    bcc: recipients.default([]),
    body: z.string().max(MAX_OUTGOING_BODY_CHARS).default(""),
  })
  .strict()
  .refine(({ to }) => to.length > 0, { message: "At least one To recipient is required.", path: ["to"] });

export const toolOutputSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
});

export const TOOL_NAMES = [
  "mail_list_accounts",
  "mail_list_mailboxes",
  "mail_search_messages",
  "mail_get_message",
  "mail_get_messages",
  "mail_get_attachment",
  "mail_set_message_state",
  "mail_create_draft",
  "mail_create_reply_draft",
  "mail_create_forward_draft",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export const inputSchemas = {
  mail_list_accounts: listAccountsInputSchema,
  mail_list_mailboxes: listMailboxesInputSchema,
  mail_search_messages: searchMessagesInputSchema,
  mail_get_message: getMessageInputSchema,
  mail_get_messages: getMessagesInputSchema,
  mail_get_attachment: getAttachmentInputSchema,
  mail_set_message_state: setMessageStateInputSchema,
  mail_create_draft: createDraftInputSchema,
  mail_create_reply_draft: createReplyDraftInputSchema,
  mail_create_forward_draft: createForwardDraftInputSchema,
} as const satisfies Record<ToolName, z.ZodType>;
