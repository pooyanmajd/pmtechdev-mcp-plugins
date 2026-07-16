# Contributing

Thanks for helping PMTechDev build trustworthy MCP servers and Codex plugins.

## Start locally

```bash
npm ci
npm run check
```

Use synthetic fixtures. Default tests must not require credentials, network access, macOS permissions, or real user data.

## Contribution workflow

1. Fork the repository and create a focused branch from the latest `main`.
2. Make the smallest coherent change and add deterministic tests where behavior changes.
3. Run `npm ci` and `npm run check` before opening a pull request.
4. Open a pull request against `main`, complete the template, and resolve review conversations.

The `main` branch is protected. Direct pushes, force pushes, and branch deletion are disabled; all changes must arrive through pull requests with required checks passing. Contributors do not need repository write access and should work from forks. Maintainers use squash merges and GitHub deletes merged branches automatically.

Do not ask for, share, or add release credentials to a contribution. Release and repository administration remain maintainer-only responsibilities.

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
- Link the issue or discussion that established scope for substantial changes.
- Update the relevant plugin changelog and the root changelog when workspace behavior changes.
- Commit regenerated bundles and verify they reproduce.
- Never include credentials, real connected content, private identifiers, or private screenshots.
- Report suspected vulnerabilities privately according to [SECURITY.md](SECURITY.md).

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
