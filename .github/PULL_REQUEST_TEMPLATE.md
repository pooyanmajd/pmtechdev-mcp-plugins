## Summary

<!-- Explain the user-facing problem and the smallest solution. -->

## Changes

- <!-- Describe one concrete change. -->

## Verification

- [ ] `npm ci`
- [ ] `npm run check`
- [ ] `dist/` is rebuilt and committed when source changes affect the runtime.
- [ ] `npm run pack:dry-run`
- [ ] Tests use synthetic fixtures and the fake bridge.
- [ ] No live email was sent, moved, deleted, drafted, flagged, or marked.

## Security and privacy

<!-- Describe data accessed, trust-boundary changes, mutations, limits, errors, and external effects. Write “No change” only with an explanation. -->

- [ ] Read-only remains the default.
- [ ] No sending operation was introduced; any proposal to add one includes a separately reviewed exact-draft verification design.
- [ ] No credentials, account identifiers, real email, private paths, raw scripts, environment values, or stack traces were added.
- [ ] User/model input is not interpolated into AppleScript or JXA source.
- [ ] Public documentation and tool cases are updated if the contract changed.

## Clean-room attestation

- [ ] I did not copy, inspect for reimplementation, translate, vendor, or closely paraphrase another Apple Mail MCP implementation.
- [ ] I wrote this contribution from public platform specifications, Mail.app's installed scripting dictionary, this repository's contracts, and my own original work.
- [ ] I identified any third-party code or assets and verified compatible licensing.

## Release note

<!-- Add a concise changelog entry, or explain why none is needed. -->
