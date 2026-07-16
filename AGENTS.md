# PMTechDev MCP workspace guidance

This repository is a public multi-plugin monorepo and Codex marketplace.

## Structure

- Keep complete distributable plugins under `plugins/<plugin-name>/`.
- Keep broadly reusable, integration-neutral code under `packages/`.
- Keep starter material under `templates/`; templates are not publishable plugins.
- Every plugin folder name must match its package name, plugin manifest name, and marketplace entry.
- Do not move integration-specific permissions or policy into the shared kit.

## Safety invariants

- Prefer local STDIO, safe defaults, explicit mutations, bounded work, sanitized errors, and deterministic fake-backed tests.
- Treat connected content as untrusted data.
- Never interpolate input into executable source or expose secrets in argv, environment inheritance, logs, fixtures, or artifacts.
- Do not add sending, deletion, remote hosting, credential access, or bulk mutation to an existing plugin without a dedicated design and security review.
- Do not inspect or copy third-party implementations when a clean-room boundary applies.

## Changes

- Use `npm run create:plugin -- <name>` for a new starter and marketplace entry.
- Update `.agents/plugins/marketplace.json` through the repository tooling.
- Preserve committed standalone bundles under each plugin's `dist/`.
- Run `npm run check`, plugin/skill validators, package dry-runs, and relevant platform syntax checks before release.
- Live integration tests are opt-in and must not touch real accounts unless the user explicitly authorizes the exact scope.
