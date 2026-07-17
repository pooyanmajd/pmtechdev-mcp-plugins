# Changelog

All notable workspace, marketplace, and shared-kit changes are recorded here. Individual plugins maintain their own changelogs inside their plugin directories.

## [Unreleased]

- Replaced the retired Node.js 20 CI lane with Node.js 22 and 24 macOS coverage, using Node.js 24 for releases.
- Enforced workspace coverage thresholds and complete plugin, MCP, skill, and agent metadata validation in the required check.
- Added an offline packaged-plugin smoke test that installs the real Mailbridge tarball and exercises only MCP initialization and `tools/list`.
- Changed release publication to attach all assets to a draft before publishing, matching repository release immutability.
- Hardened public contribution and repository governance with protected-branch guidance, code ownership, pinned GitHub Actions, CodeQL, dependency review, and private vulnerability reporting.
- Improved Mailbridge search responsiveness by pushing supported metadata filters into Mail.app without weakening scan bounds or compatibility fallback behavior.
- Pinned the workspace build toolchain to patched esbuild 0.28.1 to remove the development-server file-read advisory.

## [0.1.0] - 2026-07-16

- Established the PMTechDev multi-plugin monorepo and Codex marketplace.
- Added the reusable `@pmtechdev/mcp-kit` safety primitives.
- Added a validated plugin starter and catalog-aware scaffolder.
- Added Mailbridge MCP as the first independently packaged plugin.

[Unreleased]: https://github.com/pooyanmajd/pmtechdev-mcp-plugins/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/pooyanmajd/pmtechdev-mcp-plugins/releases/tag/v0.1.0
