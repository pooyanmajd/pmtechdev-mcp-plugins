# Privacy policy

Effective: 2026-07-16

Mailbridge MCP is local-only open-source software. The project does not operate a hosted Mailbridge service, user account system, analytics endpoint, telemetry collector, advertising system, or data broker.

## Data Mailbridge can process

At your direction and within its configured policy, Mailbridge can ask Mail.app for:

- account and mailbox display metadata;
- message metadata, headers, and selected bounded body content;
- attachment metadata and selected attachment content;
- draft recipients, subjects, and bodies;
- read and flagged state.

This information can be personal, confidential, or legally protected. Use the narrowest account scope and query that meets your need.

## Where data goes

Mailbridge communicates with its MCP client over local STDIO and with Mail.app through macOS Automation. It does not add an application-level network destination. Mail.app may communicate with your email providers under the accounts and policies you configured in Mail.app. Your MCP client or model provider may separately receive tool inputs and results according to that product's settings and privacy terms; Mailbridge does not control those systems.

Before using a cloud-hosted model with Mailbridge, decide whether the selected email may be sent to that provider. Consider local models or stricter client data controls for sensitive mail.

## Storage and retention

Mailbridge does not maintain its own message database, credentials store, analytics history, or background index. Mail.app, the MCP client, terminal capture, system logs, model-provider history, crash tooling, and drafts created in Mail.app may retain data independently. Consult those products' controls and delete retained data there when appropriate.

## Credentials

Mailbridge does not request or manage email passwords, app passwords, OAuth tokens, or provider API keys. Authentication remains with Mail.app and the configured email provider. Do not place secrets in Mailbridge environment variables or bug reports.

## User controls

- Keep `MAILBRIDGE_MODE=read-only` unless a write workflow is necessary.
- Set `MAILBRIDGE_ALLOWED_ACCOUNTS` to limit visible accounts.
- Bound searches and retrieve full messages or attachments only when needed.
- Review and send generated drafts manually in Mail.app; Mailbridge v0.1 has no send tool.
- Revoke the host application's access to Mail under **System Settings → Privacy & Security → Automation**.
- Remove the MCP configuration or plugin to stop using Mailbridge.

## Children's data and regulated use

Mailbridge is a general developer tool and is not directed to children. It provides no compliance guarantee for health, financial, employment, educational, legal, export-controlled, or other regulated data. You are responsible for determining whether your use, MCP client, and model provider satisfy applicable policies and law.

## Changes and contact

Material changes will be recorded in the repository history and, when appropriate, the changelog. Questions can be sent to **pooyanmjd@gmail.com**. Report vulnerabilities according to [SECURITY.md](SECURITY.md), not through a public issue.
