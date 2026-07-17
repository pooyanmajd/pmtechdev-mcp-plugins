# PMTechDev MCP & Plugins privacy policy

Effective: 2026-07-16

This repository contains open-source MCP servers and Codex plugins. PMTechDev does not operate a shared user account system, analytics endpoint, telemetry collector, advertising system, or data broker for these plugins unless a future integration explicitly documents otherwise.

## Data plugins can process

Each plugin documents its own data surface. The current Mailbridge plugin can process account and mailbox metadata, message metadata and selected content, downloaded attachments, draft content, read or flagged state, and explicitly approved outgoing message content at the user's direction.

Connected information can be personal, confidential, or legally protected. Use the narrowest plugin, account or resource scope, query, and result size that meets your need.

## Where data goes

Plugins communicate with their MCP client and the systems named in their documentation. Mailbridge uses local STDIO and macOS Automation and adds no application-level network destination. Mail.app communicates with configured providers and, only in explicit send mode, the approved recipients of outgoing messages.

Your MCP client or model provider may separately receive tool inputs and results according to that product's settings and privacy terms. Before using a cloud-hosted model, decide whether selected connected data may be sent to that provider.

For high-sensitivity mail, prefer a model and host whose data handling you have reviewed, use a local model when that is the appropriate control, keep Mailbridge read-only, configure a narrow account allowlist, and retrieve message bodies or attachments only when necessary. Local STDIO prevents Mailbridge from adding a hosted relay; it does not make the surrounding MCP client or model local.

## Storage and retention

Plugins must document storage they create. Mailbridge maintains no message database, credentials store, analytics history, or background index. It does persist one local, per-user preferences file recording only a chosen permission mode and allowed account email addresses — no passwords, tokens, or message content — written with restrictive file permissions, and never part of this repository or the shared plugin package. Mailbridge itself never transmits that file over a network. Its tool results (including the saved mode, account addresses, and the file's absolute local path) do flow back through MCP like any other tool result, so the same "Where data goes" guidance above applies: your MCP client or model provider may receive them according to that product's settings. Connected applications, MCP clients, terminals, system logs, model-provider history, and crash tooling may retain data independently.

## Credentials

No plugin may harvest credentials. When authentication is required, the plugin documentation must identify the mechanism, storage owner, scopes, and revocation path. Never put secrets in repository files, process arguments, logs, fixtures, or bug reports.

## User controls

- Keep plugins in read-only or least-privilege mode unless a write workflow is necessary.
- Configure allowlists and retrieve full records or attachments only when needed.
- Review mutations and open-world effects.
- Revoke connector, provider, or OS permissions when no longer needed.
- Remove the MCP configuration or plugin to stop using it.

## Regulated use

These are general developer tools and provide no compliance guarantee for health, financial, employment, educational, legal, export-controlled, or other regulated data. You are responsible for determining whether your use and model provider meet applicable requirements.

Questions can be sent to **pooyanmjd@gmail.com**. Report vulnerabilities according to [SECURITY.md](SECURITY.md).
