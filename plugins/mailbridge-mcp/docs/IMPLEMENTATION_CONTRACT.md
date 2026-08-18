# Implementation contract

## Product boundary

Mailbridge MCP is a macOS-only, local STDIO MCP server and Codex, Claude Code, and Grok plugin. It uses Mail.app's public automation dictionary so one MCP connection can work with every account already configured in Mail.app.

The public surface is intentionally bounded to safe inbox workflows and explicit, attachment-free single-message sending—not mailbox administration.

## Tool surface

Read tools:

- `mail_list_accounts`
- `mail_list_mailboxes`
- `mail_search_messages`
- `mail_get_message`
- `mail_get_messages`
- `mail_get_attachment`
- `mail_preview_outbound`

Write tools:

- `mail_set_message_state` (read and flagged state only)
- `mail_create_draft`
- `mail_create_reply_draft`
- `mail_create_forward_draft`
- `mail_send_message` (one confirmed attachment-free new message)
- `mail_send_reply` (one confirmed attachment-free reply or reply-all; Mail generates the actual reply subject from the selected source message)

Local preference tools (server self-configuration, not Mail data; available in every mode):

- `mailbridge_get_access_preferences`
- `mailbridge_set_access_preferences` (requires literal `confirmed: true`)

Explicitly out of scope: sending edited drafts, forwards, attachments, or batches; permanent deletion; mailbox/rule CRUD; direct database access; arbitrary AppleScript execution; background monitoring; remote MCP hosting; and credential management.

## Data and identity

- Account IDs and mailbox IDs are opaque stable strings returned by the bridge; callers must not invent them.
- Message IDs are opaque bridge IDs plus the RFC Message-ID when available.
- Every message result includes its account and mailbox identity.
- Search defaults to newest-first Inbox scope and returns bounded message metadata plus `scannedCount` and `incomplete`. Without an allowlist or explicit account/mailbox ID, multiple visible accounts fail closed; a mailbox ID already carries its account scope, while a sole visible account for a truly unscoped search is pinned by opaque ID into the search operation. Full body access requires `mail_get_message` or bounded `mail_get_messages`, and an incomplete search must be narrowed before absence is treated as conclusive.

## Runtime architecture

1. `src/cli.ts` parses configuration and starts the STDIO server.
2. `src/server/` registers MCP tools, schemas, annotations, and output formatting. Registration is mode-scoped; see [Architecture](ARCHITECTURE.md) for the advertising-vs-enforcement split.
3. `src/mail/` defines the bridge interface and domain values.
4. `src/mail/runner.ts` invokes the fixed `runtime/mailbridge.jxa.js` dispatcher through `/usr/bin/osascript -l JavaScript`.
5. JXA receives one bounded UTF-8 JSON request through stdin; no input is embedded into executable source, process arguments, environment variables, or temporary request files.
6. Tests inject a fake bridge and never require Mail.app.

## Configuration

- `MAILBRIDGE_MODE=read-only|drafts|full|prompted|send` (direct default `read-only`; bundled marketplace mode `prompted`)
- `full` retains its historical non-send behavior. `prompted` enables sends only after MCP form elicitation shows and confirms the exact sender, recipients, body, and new-message subject or reply-to subject context; Mail generates the actual reply subject. `send` enables reviewed direct sends.
- `MAILBRIDGE_ALLOWED_ACCOUNTS` optionally limits account email addresses (comma-separated). It must be explicitly set in the environment for direct `send` mode; a model-writable local allowlist cannot satisfy that requirement. Prompted mode instead requires a fresh client confirmation for every send.
- `MAILBRIDGE_MAX_RESULTS` caps search results (hard maximum 100)
- `MAILBRIDGE_MAX_BODY_CHARS` caps returned message text
- `MAILBRIDGE_TIMEOUT_MS` caps every automation subprocess
- An unset mode/allowlist normally falls back to a local per-user preferences file before the built-in `read-only` default. The exception is direct `send` mode, whose allowlist must also originate in the environment; see [README § Local access preferences](../README.md#local-access-preferences).

## MCP annotations

- List/search/get tools: `readOnlyHint=true`, `destructiveHint=false`, `openWorldHint=false`.
- State and draft tools: `readOnlyHint=false`, `destructiveHint=false`, `openWorldHint=false`.
- Send tools: `readOnlyHint=false`, `destructiveHint=true`, `idempotentHint=false`, `openWorldHint=true`.

## Error model

Return stable typed error codes such as `UNSUPPORTED_PLATFORM`, `AUTOMATION_DENIED`, `MAIL_NOT_CONFIGURED`, `NOT_FOUND`, `AMBIGUOUS_ID`, `READ_ONLY`, `ACCOUNT_SCOPE_REQUIRED`, `CONFIRMATION_UNAVAILABLE`, `SEND_NOT_CONFIRMED`, `AUTOMATION_BUSY`, `MUTATION_OUTCOME_UNKNOWN`, `SEND_REJECTED`, `SEND_CONTENT_CHANGED`, `SEND_TARGET_CHANGED`, `TIMEOUT`, and `MAIL_AUTOMATION_ERROR`. Do not leak raw scripts, environment variables, credentials, or stack traces to tool callers.

## Packaging

- TypeScript source with strict type checking.
- A bundled ESM executable in `dist/` so the plugin can run without installing runtime dependencies.
- The Codex, Claude Code, and Grok manifests each register the committed `dist/cli.js` bundle with that host's plugin-root path semantics.
- Public artifacts include README, architecture, security policy, privacy policy, terms, contributing guide, changelog, license, and CI.
