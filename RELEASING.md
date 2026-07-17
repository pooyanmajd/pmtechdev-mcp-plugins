# Releasing PMTechDev plugins

Releases are immutable review points for users who do not want to install a moving marketplace branch. Mailbridge uses repository tag `vX.Y.Z`, matching its package and plugin manifest version, and a GitHub release titled `mailbridge-mcp@X.Y.Z`.

## Prepare

1. Update the plugin `package.json`, `.codex-plugin/plugin.json`, MCP server version, changelog, and documentation together.
2. Run the complete workspace validation on macOS:

   ```bash
   npm ci
   npm run check
   npm audit --omit=dev
   npm run pack:dry-run -w mailbridge-mcp
   ```

3. Inspect the package dry-run and committed `dist/` diff. Confirm the fixed dispatcher and bundle still contain no send surface.
4. Merge the release PR through protected `main`; do not tag an unreviewed branch.

## Publish

Create the version tag from the reviewed `main` commit. Use a signed annotated tag when the maintainer has a configured signing identity; the release workflow independently creates Sigstore-signed provenance and SBOM attestations for the packaged artifact.

```bash
git switch main
git pull --ff-only
git tag -s v0.1.0 -m "mailbridge-mcp@0.1.0"
git push origin v0.1.0
```

The tag starts `.github/workflows/release-mailbridge.yml`. The workflow requires GitHub to verify the annotated tag signature, repeats the workspace checks, validates the tag against all Mailbridge version declarations, packages the distributable plugin, generates a CycloneDX build SBOM and SHA-256 checksums, creates signed attestations, and publishes the GitHub release.

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
