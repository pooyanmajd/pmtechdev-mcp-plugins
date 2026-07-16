## Summary

<!-- Explain the user-facing problem and smallest solution. -->

## Component

<!-- Name the plugin, shared package, template, or workspace tooling changed. -->

## Verification

- [ ] `npm ci`
- [ ] `npm run check`
- [ ] Affected committed `dist/` bundles were rebuilt.
- [ ] Affected plugin package dry-runs and validators passed.
- [ ] Tests use synthetic data and deterministic fakes.

## Security and privacy

<!-- Describe authentication, data, trust boundaries, mutations, limits, retry behavior, and external effects. -->

- [ ] Read-only or least-privilege behavior remains the default.
- [ ] No credentials, connected content, private IDs, paths, environment values, or stack traces were added.
- [ ] Input is not interpolated into executable source or exposed through unsafe transports.
- [ ] Marketplace, manifest, tool, skill, and policy documentation remain consistent.

## Clean-room and licensing

- [ ] I did not copy, translate, vendor, or closely paraphrase an implementation without compatible licensing and attribution.
- [ ] I identified third-party code/assets and verified compatible licenses.

## Release note

<!-- Add the relevant root/plugin changelog entry, or explain why none is needed. -->
