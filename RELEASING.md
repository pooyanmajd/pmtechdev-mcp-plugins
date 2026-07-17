# Releasing PMTechDev plugins

Releases are immutable review points for users who do not want to install a moving marketplace branch. Mailbridge uses repository tag `vX.Y.Z`, matching its package and plugin manifest version, and a GitHub release titled `mailbridge-mcp@X.Y.Z`.

Repository administration must keep release immutability enabled and an active `v*` tag ruleset that blocks tag updates and deletion. These controls intentionally have no maintainer bypass.

## Prepare

1. Update the plugin `package.json`, `.codex-plugin/plugin.json`, MCP server version, changelog, and documentation together.
2. Use Node.js 24 and run the complete workspace validation on macOS:

   ```bash
   npm ci
   npm run check
   npm audit
   ```

3. Inspect the packaged-plugin smoke result and committed `dist/` diff. Confirm the installed executable completed MCP initialization and `tools/list` without invoking Mail, and that the fixed dispatcher and bundle still contain no send surface.
4. Merge the release PR through protected `main`; do not tag an unreviewed branch.

## Publish

Create the version tag from the reviewed `main` commit. Use a signed annotated tag when the maintainer has a configured signing identity; the release workflow independently creates Sigstore-signed provenance and SBOM attestations for the packaged artifact.

```bash
git switch main
git pull --ff-only
git tag -s vX.Y.Z -m "mailbridge-mcp@X.Y.Z"
git push origin vX.Y.Z
```

The tag starts `.github/workflows/release-mailbridge.yml`. The workflow requires GitHub to verify the annotated tag signature, repeats the workspace checks, validates the tag against all Mailbridge version declarations, packages the distributable plugin, generates a CycloneDX build SBOM and SHA-256 checksums, creates signed attestations, attaches every asset to a draft release, and only then publishes the immutable GitHub release.

If local tag signing is not configured, stop and configure an approved GPG or SSH signing identity rather than silently publishing an unsigned maintainer tag.

## Verify

Download `mailbridge-mcp-X.Y.Z.tgz`, its SBOM, and `SHA256SUMS` from the GitHub release, then verify both the checksum and GitHub attestation:

```bash
shasum -a 256 -c SHA256SUMS
gh attestation verify mailbridge-mcp-X.Y.Z.tgz --repo pooyanmajd/pmtechdev-mcp-plugins
```

Test a pinned marketplace installation in an isolated Codex home before announcing the release:

```bash
codex plugin marketplace add pooyanmajd/pmtechdev-mcp-plugins --ref vX.Y.Z
codex plugin add mailbridge-mcp@pmtechdev
```

Start a new Codex task, confirm the plugin is read-only by default, and use only deterministic or synthetic data during release verification. Live Mail access remains opt-in and must never send, delete, move, or bulk-mutate real content.
