# Contributing

Thank you for helping make Mailbridge safer and easier to audit.

## Before you start

- Read [AGENTS.md](AGENTS.md), [Architecture](docs/ARCHITECTURE.md), and [Security](SECURITY.md).
- Search existing issues and discussions before proposing overlapping work.
- For a vulnerability, follow the private reporting process in [SECURITY.md](SECURITY.md).
- For a substantial feature or public API change, open an issue before investing in implementation.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Clean-room requirement

This project is an original implementation derived from Mail.app's installed public scripting dictionary, public MCP specifications/SDKs, and this repository's own design documents. Do not copy, translate, vendor, inspect for reimplementation, or closely paraphrase source code, tests, prompts, schemas, documentation, names, or implementation details from another Apple Mail MCP project.

Contributors must identify any third-party code or asset they introduce and confirm its compatible license. Do not use Apple logos, provider logos, proprietary screenshots, or branding that implies endorsement.

## Development setup

Requirements: macOS for real bridge work, Node.js 20 or newer, and npm.

```bash
npm ci
npm run check
npm run pack:dry-run
```

Default tests must use the fake bridge and must pass without Mail.app, account credentials, network access, or macOS Automation consent. Do not add real email fixtures, account addresses, tokens, message bodies, or mailbox exports to the repository.

## Engineering rules

- Preserve local STDIO as the only transport.
- Keep read-only mode as the default and do not add a send surface without a separately reviewed exact-draft verification design.
- Do not interpolate tool or model input into AppleScript/JXA source or expose it in process arguments/environment variables; pass bounded structured data through stdin.
- Keep tools bounded and validate inputs at the server boundary.
- Preserve stable, sanitized public errors.
- Do not add permanent deletion, arbitrary scripting, direct Mail database access, hidden network calls, telemetry, credential handling, or background monitoring.
- Keep live Mail tests opt-in, read-only, narrow, and visibly labeled. Never send, move, delete, flag, mark, or draft against a real account in automated testing.

## Pull requests

1. Create a focused branch and make one coherent change.
2. Add or update deterministic tests for behavior changes.
3. Rebuild and commit `dist/` when source changes affect the runtime; confirm the generated diff contains no unrelated or machine-specific data.
4. Update `NOTICE` from package metadata and license files when code from bundled dependencies changes.
5. Update README, architecture, security/privacy material, tool cases, and changelog when the public contract changes.
6. Run `npm run check` and `npm run pack:dry-run`.
7. Explain security and privacy impact in the pull-request template.

Keep commits reviewable. Avoid unrelated formatting or dependency churn. Maintainers may ask for changes, split large patches, or decline features that widen the safety boundary.

## Commit and release style

Use concise imperative commit subjects, for example `Harden account ID validation`. Releases follow semantic versioning while honoring pre-1.0 status. User-visible changes belong in [CHANGELOG.md](CHANGELOG.md) under an Unreleased heading before release.

By submitting a contribution, you represent that you have the right to license it to the project under the MIT License.
