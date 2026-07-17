# PMTechDev MCP & Plugins

[![CI](https://github.com/pooyanmajd/pmtechdev-mcp-plugins/actions/workflows/ci.yml/badge.svg)](https://github.com/pooyanmajd/pmtechdev-mcp-plugins/actions/workflows/ci.yml)
[![CodeQL](https://github.com/pooyanmajd/pmtechdev-mcp-plugins/actions/workflows/codeql.yml/badge.svg)](https://github.com/pooyanmajd/pmtechdev-mcp-plugins/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

PMTechDev MCP & Plugins is an expandable monorepo, reusable development kit, and Codex marketplace for local-first Model Context Protocol servers and plugins maintained by PMTechDev.

The repository keeps each integration independently buildable under `plugins/`, while shared safety primitives live under `packages/`. New integrations start from a tested scaffold instead of rebuilding packaging, policy, CI, and MCP boilerplate from scratch.

## Available plugins

| Plugin | Purpose | Platforms | Status |
| --- | --- | --- | --- |
| [Mailbridge MCP](plugins/mailbridge-mcp/README.md) | Search, read, manage state, and create drafts through accounts configured in macOS Mail. | macOS | `0.1.2` |

Mailbridge is draft-only in v0.1 and intentionally exposes no send operation.

## Repository layout

```text
pmtechdev-mcp-plugins/
├── .agents/plugins/marketplace.json  # Codex marketplace catalog
├── packages/
│   └── mcp-kit/                      # Reusable safety and queue primitives
├── plugins/
│   └── mailbridge-mcp/               # Independent MCP + Codex plugin payload
├── templates/
│   └── mcp-plugin/                   # Starter copied by the scaffolder
└── scripts/
    ├── create-plugin.mjs             # Generates and registers a plugin
    └── validate-workspace.mjs        # Validates catalog/package invariants
```

## Install from the PMTechDev marketplace

Install the current marketplace snapshot:

```bash
codex plugin marketplace add https://github.com/pooyanmajd/pmtechdev-mcp-plugins
codex plugin add mailbridge-mcp@pmtechdev
```

For a reviewed, immutable version, pin the marketplace to the Mailbridge `0.1.2` release tag instead:

```bash
codex plugin marketplace add pooyanmajd/pmtechdev-mcp-plugins --ref v0.1.2
codex plugin add mailbridge-mcp@pmtechdev
```

Start a new Codex task after installing or updating a plugin so its skills and MCP tools are loaded.

Only install Mailbridge in a trusted Codex or MCP host: the launching host receives macOS Automation authority for Mail. The marketplace configuration is read-only by default, but selected mail and tool results may still be sent to the model provider configured in that host. Review the [Mailbridge install and privacy guidance](plugins/mailbridge-mcp/README.md#install-as-a-codex-plugin) before connecting sensitive accounts.

## Develop the workspace

Requirements are Node.js 22 or 24 and npm. These are the supported LTS lines tested on macOS.

```bash
git clone https://github.com/pooyanmajd/pmtechdev-mcp-plugins.git
cd pmtechdev-mcp-plugins
npm ci
npm run check
```

The root check enforces coverage thresholds, builds every workspace, validates all plugin and skill metadata, installs the real Mailbridge tarball in a temporary directory, performs MCP initialization plus `tools/list` without invoking Mail, validates committed plugin bundles, and checks marketplace consistency.

## Create the next plugin

```bash
npm run create:plugin -- example-mcp
npm install
npm run check -w example-mcp
npm run validate:workspace
```

The scaffolder normalizes the name, copies the starter, creates a valid `.codex-plugin/plugin.json` and `.mcp.json`, adds a safe status tool and skill, and appends a complete marketplace entry. Replace the generated placeholder scope with the real integration design before publication.

Reusable primitives are exported by `@pmtechdev/mcp-kit`:

- minimal subprocess environments that avoid inheriting unrelated secrets;
- UTF-8 JSON request byte bounds;
- bounded FIFO serialization for non-idempotent operations.

Add only broadly reusable, well-tested infrastructure to the kit. Integration-specific policy stays inside its plugin.

## Design rules

- Local STDIO is the default transport. Remote services must be explicit and documented.
- Read-only or least-privilege behavior is the default.
- Connected content is untrusted data, not agent instructions.
- Secrets never belong in process arguments, logs, committed fixtures, or generated artifacts.
- Every search, body, attachment, subprocess, queue, and response is bounded.
- Mutations require explicit tools, clear annotations, deterministic tests, and safe retry semantics.
- Each plugin remains independently packageable and owns its runtime-specific documentation.

See [Contributing](CONTRIBUTING.md), [Releasing](RELEASING.md), [Support](SUPPORT.md), [Security](SECURITY.md), [Privacy](PRIVACY.md), and [Terms](TERMS.md). The workspace and bundled plugins are available under the [MIT License](LICENSE).

Copyright © 2026 PMTechDev / Pooyan Majd.
