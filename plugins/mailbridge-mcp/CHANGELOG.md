# Changelog

All notable changes to this project will be documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/pooyanmajd/pmtechdev-mcp-plugins/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/pooyanmajd/pmtechdev-mcp-plugins/releases/tag/v0.1.0
