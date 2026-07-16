# Contributing

Thanks for helping PMTechDev build trustworthy MCP servers and Codex plugins.

## Start locally

```bash
npm ci
npm run check
```

Use synthetic fixtures. Default tests must not require credentials, network access, macOS permissions, or real user data.

## Add a plugin

Start with the repository scaffolder:

```bash
npm run create:plugin -- your-plugin-name
npm install
```

Then replace the starter with a concrete implementation and document:

- user problem and explicit non-goals;
- authentication and trust boundaries;
- complete tool surface and annotations;
- data destinations and retention;
- default mode, mutation gates, bounds, timeout and retry behavior;
- deterministic positive, negative, injection, and failure tests;
- packaging and platform requirements.

Keep the folder, npm package, `.codex-plugin/plugin.json`, and marketplace names identical. Marketplace entries require installation/authentication policy and category metadata.

## Shared code

Move code into `packages/mcp-kit` only when at least two integrations can use it without importing integration-specific concepts. Shared primitives require focused unit tests and stable, narrow APIs.

## Pull requests

- Keep changes scoped and explain security-sensitive decisions.
- Update the relevant plugin changelog and the root changelog when workspace behavior changes.
- Commit regenerated bundles and verify they reproduce.
- Never include credentials, real connected content, private identifiers, or private screenshots.
- Report suspected vulnerabilities privately according to [SECURITY.md](SECURITY.md).

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
