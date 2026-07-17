# Releasing PMTechDev plugins

Releases are immutable review points for users who do not want to install a moving marketplace branch. Mailbridge uses repository tag `vX.Y.Z`, matching its package and plugin manifest version, and a GitHub release titled `mailbridge-mcp@X.Y.Z`.

Repository administration must keep release immutability enabled and an active `v*` tag ruleset that blocks tag updates and deletion. These controls intentionally have no maintainer bypass.

## Prepare

1. Update the root and plugin `package.json` files, lockfile, Codex and Claude Code plugin manifests, MCP server version, changelog, and documentation together.
2. Use Node.js 24 and run the complete workspace validation on macOS:

   ```bash
   npm ci
   npm run check
   npm audit
   ```

3. Inspect the packaged-plugin smoke result and committed `dist/` diff. Confirm the installed executable completed MCP initialization and `tools/list` without invoking Mail, and that the fixed dispatcher and bundle contain only the reviewed atomic send surface—never draft, forward, attachment, or bulk sending.
4. Merge the release PR through protected `main`; do not tag an unreviewed branch.

## Publish automatically from protected main

Merge the versioned release PR through protected `main`. When the version has no existing release tag, the `Release Mailbridge` workflow repeats every release check, creates an immutable annotated `vX.Y.Z` tag for that exact merge commit, and publishes the release. Ordinary main-branch changes whose version is already released exit without creating or changing anything.

For an owner-only retry before the release tag exists, open **Actions → Release Mailbridge → Run workflow** from the default branch. The workflow rejects dispatches from other refs and checks the triggering actor against the repository owner before reading or publishing the release. It never updates version files or bypasses protected main; the reviewed version bump must already be merged.

If a run creates the immutable tag but fails before publishing its release, open that exact failed run and choose **Re-run all jobs**. Reruns are owner-gated and check out the original event commit, so this remains safe and recoverable even if `main` has advanced since the failure.

Both automatic and owner-dispatched releases produce GitHub-signed artifact provenance and SBOM attestations. The repository tag ruleset prevents release-tag updates and deletion.

## Publish from a maintainer-signed tag

The explicit tag-trigger path remains available. Create the version tag from the reviewed `main` commit using a configured signing identity:

```bash
git switch main
git pull --ff-only
git tag -s vX.Y.Z -m "mailbridge-mcp@X.Y.Z"
git push origin vX.Y.Z
```

The tag starts `.github/workflows/release-mailbridge.yml`. For externally pushed tags, the workflow requires both the repository owner as the actor and GitHub verification of the annotated tag signature. Every release path validates the version declarations, package, Codex and Claude Code manifests, deterministic MCP smoke tests, SBOM, checksums, and attestations before publication.

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

Validate the same pinned release through Claude Code:

```bash
claude plugin marketplace add pooyanmajd/pmtechdev-mcp-plugins@vX.Y.Z
claude plugin install mailbridge-mcp@pmtechdev
```

Start a new Codex task or run `/reload-plugins` in Claude Code, confirm the plugin is read-only by default, and use only deterministic or synthetic data during release verification. Live Mail access remains opt-in and release verification must never send, delete, move, or bulk-mutate real content.
