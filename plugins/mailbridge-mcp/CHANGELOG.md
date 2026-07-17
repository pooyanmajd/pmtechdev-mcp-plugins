# Changelog

All notable changes to this project will be documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] - 2026-07-17

### Added

- `mailbridge_get_access_preferences` and `mailbridge_set_access_preferences` tools, and a local, per-user access-preferences file (`~/Library/Application Support/mailbridge-mcp/preferences.json` by default) so a user's chosen mode and account allowlist can be saved once and reused across sessions without editing any shared or git-tracked configuration file. An explicitly set environment variable always takes precedence over a saved value. Both tools are available in every mode, including `read-only`.
- Mode-scoped tool registration: each tool now advertises only in the modes that can actually use it, so a `read-only` server no longer offers `mail_send_message` and similar tools only to have them fail closed. The two access-preference tools are always registered.

### Security

- `mailbridge_set_access_preferences` can no longer save direct `send` mode. A model-supplied `confirmed: true` is not an independently verified human confirmation the way MCP elicitation is, so allowing this tool to grant standing, unconfirmed send authority for a future session would let a compromised or prompt-injected host escalate itself with no equivalent of the per-send confirmation gate. Elevating to `send` mode stays a manual, human-performed environment-variable change.
- Concurrent pending send confirmations are now bounded by a dedicated serial queue, independent of the Mail automation queue. Excess concurrent send attempts fail closed with the new `CONFIRMATION_BUSY` rather than accumulating unbounded pending client-side prompts.
- The local preferences file is now read and written with `lstat`-based no-follow checks: a pre-existing symlink, wrong entry type, or an entry owned by a different user at the config directory or file is refused rather than followed. Closes a real issue where `chmod` on a symlinked config directory silently modified the symlink's target, exploitable if `XDG_CONFIG_HOME` points at a shared location.
- Reading the local preferences file now rejects a file above a small fixed size before loading it, instead of reading the complete file into memory unconditionally on every startup.

### Fixed

- A pending prompted-mode send confirmation no longer occupies a slot in the bounded automation queue for its full duration; only the actual Mail.app/JXA call is now serialized, so unrelated read calls can no longer be starved into `AUTOMATION_BUSY` while a human is still reviewing a send.
- Elicitation confirmation prompts now join review sections with a Unicode line separator instead of an ordinary newline, since Codex renders ordinary newlines in elicitation messages as collapsed whitespace.
- Send/reply verification now tolerates the single trailing ASCII space current Mail.app appends to any script-set outgoing body as the only permitted post-approval body difference; every other change still fails closed with `SEND_CONTENT_CHANGED`.
- `mail_send_message` and `mail_create_draft` no longer fail with a generic `MAIL_AUTOMATION_ERROR` against real Mail.app: a freshly constructed outgoing message did not expose settable recipient lists until after being registered with `Mail.outgoingMessages`, so addressing must happen after that registration, not before. Every JXA-level fake in the test suite that constructs an outgoing message now enforces this same ordering, closing a gap where the 100%-fake-backed suite could not previously catch it.

### Documentation

- Corrected `PRIVACY.md`'s claim that saved preference values are never transmitted: Mailbridge itself never sends the file over a network, but tool results (including the saved values and the file's absolute local path) flow back through MCP like any other tool result and may reach the configured model provider.

## [0.3.0] - 2026-07-17

### Changed

- The bundled Codex and Claude Code plugins now start in `prompted` mode, allowing draft creation and requiring a fresh exact-content client confirmation before every send.

### Security

- Encoded untrusted header fields and quoted every body line in send confirmations so email content cannot spoof the review prompt's trusted labels or delimiters.
- Rejected control, line-separator, and bidirectional formatting characters in new-message subjects before a send can be confirmed.
- Preserved the reviewed allowlisted `send` mode for direct registrations while adding fail-closed errors for unavailable or declined prompted confirmations.

## [0.2.2] - 2026-07-17

### Added

- Account-first targeted-search guidance, configurable search budgets, explicit stop diagnostics, and authenticated continuation cursors.
- Normalized exact-subject matching with a guarded case-invariant Mail-native reference prefilter and indexed fallback.
- Native Claude Code plugin and marketplace manifests that launch the committed MCP bundle in read-only mode.
- Protected-main automatic releases plus an owner-only manual workflow path for safe one-click release retries.

### Fixed

- Large mailbox selections now return bounded partial coverage instead of refusing searches above the cursor mailbox cap.
- Mixed-case subjects and out-of-order timestamps can no longer produce false complete-search claims.

### Documentation

- Clarified supported Codex plugin surfaces, prebuilt installation requirements, and the current marketplace command.

## [0.2.1] - 2026-07-17

### Fixed

- Release SBOM attestation now receives the exact generated CycloneDX file path instead of an unsupported wildcard.

## [0.2.0] - 2026-07-17

### Added

- Opt-in `mail_send_message` and `mail_send_reply` tools for one confirmed attachment-free new message or reply.
- A dedicated send capability design and security review covering authorization, prompt injection, attachment, duplicate-send, and delivery-status risks.
- Stable `SEND_REJECTED` handling and deterministic fixed-dispatcher send tests.

### Security

- Sending requires the new `send` mode, a non-empty `MAILBRIDGE_ALLOWED_ACCOUNTS`, a substantive bounded body, and literal per-call confirmation.
- Existing `full` configurations remain unable to send, preventing privilege escalation on upgrade.
- Edited drafts, forwards, attachments, and bulk sends remain unsupported; uncertain send outcomes fail with `MUTATION_OUTCOME_UNKNOWN` and must not be retried blindly.

## [0.1.2] - 2026-07-17

### Changed

- Message resolution now tries Mail's by-id specifier first and keeps the bounded indexed scan as fallback, so single and batch reads in large mailboxes no longer rescan the message collection.

## [0.1.1] - 2026-07-17

### Added

- Bounded `mail_get_messages` batch reads for shortlisted messages.

### Changed

- Inbox-scoped search now defaults to a newest-first k-way merge across allowed accounts instead of rescanning complete mailboxes.
- Search has an internal time budget derived from the configured subprocess timeout and reports partial coverage with `incomplete` before that outer deadline.
- Mail automation is serialized with bounded backpressure so concurrent reads cannot overload Mail.app.
- Runtime configuration now passes `maxResults` through to every bridge operation.

## [0.1.0] - 2026-07-16

### Added

- Local macOS STDIO MCP server for accounts configured in Mail.app.
- Bounded account, mailbox, search, message, and attachment read tools.
- Read and flagged state updates plus new, reply, and forward draft tools.
- Draft-only composition surface; v0.1 intentionally exposes no send operation.
- Read-only default, account allowlist, configurable limits, timeouts, and stable sanitized errors.
- Fixed JXA dispatcher invocation using bounded stdin data rather than source interpolation or process arguments.
- Codex plugin manifest, local MCP configuration, and safe-use Mailbridge skill.
- Deterministic fake-bridge tests, macOS CI, public security/privacy policies, and original brand assets.

### Changed

- Accelerated bounded message search with Mail-native metadata predicates when supported, while retaining indexed fallback behavior and avoiding eager mailbox materialization.

[Unreleased]: https://github.com/pooyanmajd/pmtechdev-mcp-plugins/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/pooyanmajd/pmtechdev-mcp-plugins/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/pooyanmajd/pmtechdev-mcp-plugins/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/pooyanmajd/pmtechdev-mcp-plugins/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/pooyanmajd/pmtechdev-mcp-plugins/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/pooyanmajd/pmtechdev-mcp-plugins/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/pooyanmajd/pmtechdev-mcp-plugins/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/pooyanmajd/pmtechdev-mcp-plugins/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/pooyanmajd/pmtechdev-mcp-plugins/releases/tag/v0.1.0
