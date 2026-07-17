# Changelog

All notable changes to this project will be documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/pooyanmajd/pmtechdev-mcp-plugins/compare/v0.2.2...HEAD
[0.2.2]: https://github.com/pooyanmajd/pmtechdev-mcp-plugins/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/pooyanmajd/pmtechdev-mcp-plugins/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/pooyanmajd/pmtechdev-mcp-plugins/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/pooyanmajd/pmtechdev-mcp-plugins/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/pooyanmajd/pmtechdev-mcp-plugins/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/pooyanmajd/pmtechdev-mcp-plugins/releases/tag/v0.1.0
