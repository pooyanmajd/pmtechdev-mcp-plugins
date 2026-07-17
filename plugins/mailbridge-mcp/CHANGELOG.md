# Changelog

All notable changes to this project will be documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/pooyanmajd/pmtechdev-mcp-plugins/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/pooyanmajd/pmtechdev-mcp-plugins/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/pooyanmajd/pmtechdev-mcp-plugins/releases/tag/v0.1.0
