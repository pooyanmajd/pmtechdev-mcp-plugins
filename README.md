# PMTechDev MCP & Plugins

[![CI](https://github.com/pooyanmajd/pmtechdev-mcp-plugins/actions/workflows/ci.yml/badge.svg)](https://github.com/pooyanmajd/pmtechdev-mcp-plugins/actions/workflows/ci.yml)
[![CodeQL](https://github.com/pooyanmajd/pmtechdev-mcp-plugins/actions/workflows/codeql.yml/badge.svg)](https://github.com/pooyanmajd/pmtechdev-mcp-plugins/actions/workflows/codeql.yml)
[![Latest release](https://img.shields.io/github/v/release/pooyanmajd/pmtechdev-mcp-plugins?display_name=tag&sort=semver)](https://github.com/pooyanmajd/pmtechdev-mcp-plugins/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

PMTechDev MCP & Plugins is an expandable monorepo, reusable development kit, and Codex and Claude Code marketplace for local-first Model Context Protocol servers and plugins maintained by PMTechDev.

The repository keeps each integration independently buildable under `plugins/`, while shared safety primitives live under `packages/`. New integrations start from a tested scaffold instead of rebuilding packaging, policy, CI, and MCP boilerplate from scratch.

## Available plugins

| Plugin | Purpose | Platforms | Status |
| --- | --- | --- | --- |
| [Mailbridge MCP](plugins/mailbridge-mcp/README.md) | Search, read, manage state, create drafts, and explicitly send through accounts configured in macOS Mail. | macOS | [`0.2.2`](https://github.com/pooyanmajd/pmtechdev-mcp-plugins/releases/tag/v0.2.2) |

Mailbridge remains read-only by default. Version 0.2 adds opt-in, allowlisted, confirmed sending for attachment-free new messages and replies; existing `full` configurations do not gain send authority.

## Repository layout

```text
pmtechdev-mcp-plugins/
├── .agents/plugins/marketplace.json  # Codex marketplace catalog
├── .claude-plugin/marketplace.json   # Claude Code marketplace catalog
├── packages/
│   └── mcp-kit/                      # Reusable safety and queue primitives
├── plugins/
│   └── mailbridge-mcp/               # Independent MCP + Codex/Claude plugin payload
├── templates/
│   └── mcp-plugin/                   # Starter copied by the scaffolder
└── scripts/
    ├── create-plugin.mjs             # Generates and registers a plugin
    └── validate-workspace.mjs        # Validates catalog/package invariants
```

## Install from the PMTechDev marketplaces

### Codex

Install the current marketplace snapshot:

```bash
codex plugin marketplace add pooyanmajd/pmtechdev-mcp-plugins --ref main
codex plugin add mailbridge-mcp@pmtechdev
```

For the reviewed, immutable release, pin the marketplace to Mailbridge `0.2.2` instead:

```bash
codex plugin marketplace add pooyanmajd/pmtechdev-mcp-plugins --ref v0.2.2
codex plugin add mailbridge-mcp@pmtechdev
```

These commands target Codex CLI. Plugins can also be installed for Codex in the ChatGPT desktop app; they are not currently available in the Codex IDE extension. See the official [Codex plugin documentation](https://learn.chatgpt.com/docs/plugins) for supported surfaces. Start a new Codex task or CLI session after installing or updating a plugin so its skills and MCP tools are loaded.

### Claude Code

Install the immutable release through the native Claude Code marketplace and plugin manifests:

```bash
claude plugin marketplace add pooyanmajd/pmtechdev-mcp-plugins@v0.2.2
claude plugin install mailbridge-mcp@pmtechdev
```

Run `/reload-plugins`, then use `/mcp` to confirm the bundled `mailbridge` server is connected. The Claude registration resolves `dist/cli.js` through `CLAUDE_PLUGIN_ROOT` and starts in read-only mode.

Mailbridge requires macOS, a working account in Mail.app, and Node.js 22 or 24. The marketplace payload is prebuilt, so npm and a source checkout are not required for plugin installation. The [immutable `0.2.2` release](https://github.com/pooyanmajd/pmtechdev-mcp-plugins/releases/tag/v0.2.2) includes the plugin tarball, SHA-256 checksums, a CycloneDX SBOM, and signed GitHub provenance attestations.

Only install Mailbridge in a trusted Codex, Claude Code, or MCP host: the launching host receives macOS Automation authority for Mail. The marketplace configuration is read-only by default, but selected mail and tool results may still be sent to the model provider configured in that host. Review the [Mailbridge security model](plugins/mailbridge-mcp/README.md#security-model) before connecting sensitive accounts.

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

The scaffolder normalizes the name, copies the starter, creates valid Codex, Claude Code, and MCP manifests, adds a safe status tool and skill, and appends complete entries to both marketplace catalogs. Replace the generated placeholder scope with the real integration design before publication.

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
