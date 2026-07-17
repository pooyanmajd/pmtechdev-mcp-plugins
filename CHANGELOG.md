# Changelog

All notable workspace, marketplace, and shared-kit changes are recorded here. Individual plugins maintain their own changelogs inside their plugin directories.

## [Unreleased]

- Corrected public installation and release documentation to identify `0.2.1` as the supported immutable Mailbridge release.
- Clarified supported Codex plugin surfaces, prebuilt installation requirements, and public support paths.
- Added Mailbridge local, per-user access-preference tools; fixed a prompted-send confirmation from occupying the automation queue for its full pending duration; and fixed `mail_send_message`/`mail_create_draft` failing against real Mail.app due to an outgoing-message addressing/registration ordering bug. See the plugin's own changelog for detail.
- Hardened Mailbridge's local preferences: the tool that saves them can no longer set direct send mode, pending send confirmations are now bounded independently of Mail automation, and the preferences file is read/written with symlink and size safeguards. Corrected a `PRIVACY.md` claim about preference data never being transmitted.

## [0.2.1] - 2026-07-17

- Published the first supported Mailbridge 0.2 release with the separately gated, allowlisted, confirmed send capability from `0.2.0`.
- Fixed release SBOM attestation by passing the exact generated CycloneDX file path.
- Published an immutable GitHub release with checksums, an SBOM, and signed provenance attestations.

## [0.2.0] - 2026-07-17

- Added Mailbridge's separately gated, allowlisted, confirmed send capability for attachment-free new messages and replies.
- Preserved legacy `full` mode as non-send to avoid privilege escalation during upgrades.
- Added a dedicated outbound-mail design/security review, fixed-dispatcher contract tests, explicit send annotations, and unknown-outcome retry protection.
- Updated plugin, marketplace, privacy, security, release, and safe-use documentation for the new boundary.
- The tag was retained for audit history, but its workflow stopped before release publication; use `0.2.1` as the supported public release.

## [0.1.2] - 2026-07-17

- Replaced the retired Node.js 20 CI lane with Node.js 22 and 24 macOS coverage, using Node.js 24 for releases.
- Enforced workspace coverage thresholds and complete plugin, MCP, skill, and agent metadata validation in the required check.
- Added an offline packaged-plugin smoke test that installs the real Mailbridge tarball and exercises only MCP initialization and `tools/list`.
- Changed release publication to attach all assets to a draft before publishing, matching repository release immutability.
- Repaired CI and release dependency audits to cover bundled runtime and toolchain dependencies; the previous `--omit=dev` audit inspected an empty production dependency list.
- Hardened public contribution and repository governance with protected-branch guidance, code ownership, pinned GitHub Actions, CodeQL, dependency review, and private vulnerability reporting.
- Improved Mailbridge search responsiveness by pushing supported metadata filters into Mail.app without weakening scan bounds or compatibility fallback behavior.
- Pinned the workspace build toolchain to patched esbuild 0.28.1 to remove the development-server file-read advisory.

## [0.1.0] - 2026-07-16

- Established the PMTechDev multi-plugin monorepo and Codex marketplace.
- Added the reusable `@pmtechdev/mcp-kit` safety primitives.
- Added a validated plugin starter and catalog-aware scaffolder.
- Added Mailbridge MCP as the first independently packaged plugin.

[Unreleased]: https://github.com/pooyanmajd/pmtechdev-mcp-plugins/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/pooyanmajd/pmtechdev-mcp-plugins/releases/tag/v0.2.1
[0.2.0]: https://github.com/pooyanmajd/pmtechdev-mcp-plugins/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/pooyanmajd/pmtechdev-mcp-plugins/releases/tag/v0.1.2
[0.1.0]: https://github.com/pooyanmajd/pmtechdev-mcp-plugins/releases/tag/v0.1.0
