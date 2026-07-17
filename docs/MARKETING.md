# Mailbridge launch kit

This document contains reusable public copy for Mailbridge for Apple Mail. Verify installation commands and supported surfaces against the release being promoted before publishing.

## One-line description

Mailbridge for Apple Mail lets Codex and Claude Code search, read, draft, and safely send across the accounts already configured on your Mac—without sharing email passwords with another connector.

## Short directory description

Connect AI agents to Apple Mail through a local, multi-account MCP server. Search and read mail, manage message state, create drafts, and send attachment-free messages and replies. Direct registrations are read-only by default; bundled plugins show the exact outbound content before every send.

## Launch post

### Title

I built a local-first Apple Mail plugin for Codex and Claude Code

### Body

Mailbridge works with every account already configured in Mail.app, so there is no separate provider-password or OAuth setup. It can search and read messages, manage state, create drafts, and send attachment-free new messages and replies.

Safety was the main design constraint: local STDIO, read-only direct-server defaults, bounded operations, no private Mail database access, no Full Disk Access, and no telemetry or hosted relay. The bundled plugins show the exact account, recipients, subject, and body before a send is accepted.

It is open source under MIT and ships as a prebuilt Codex and Claude Code marketplace plugin:

https://github.com/pooyanmajd/pmtechdev-mcp-plugins

I would especially value feedback on first-run installation and the permission flow on different macOS versions.

## Social posts

### Compact

I built Mailbridge for Apple Mail: a local-first plugin that lets Codex and Claude Code work across every account already configured on your Mac. No separate email credentials, read-only by default, and exact-content confirmation before sends. Open source: https://github.com/pooyanmajd/pmtechdev-mcp-plugins

### Outcome-led

“Read my latest three Inbox messages across configured accounts.”

“Reply to the latest one and say thanks.”

Mailbridge for Apple Mail makes that flow work locally through Mail.app, with the exact sender, recipients, subject, and body shown before sending. Open source for Codex and Claude Code: https://github.com/pooyanmajd/pmtechdev-mcp-plugins

## Directory submission fields

- **Name:** Mailbridge for Apple Mail
- **Category:** Productivity / Email
- **Platforms:** macOS
- **License:** MIT
- **Source:** https://github.com/pooyanmajd/pmtechdev-mcp-plugins
- **Documentation:** https://github.com/pooyanmajd/pmtechdev-mcp-plugins/tree/main/plugins/mailbridge-mcp
- **Privacy policy:** https://github.com/pooyanmajd/pmtechdev-mcp-plugins/blob/main/PRIVACY.md
- **Security policy:** https://github.com/pooyanmajd/pmtechdev-mcp-plugins/blob/main/SECURITY.md
- **Support:** https://github.com/pooyanmajd/pmtechdev-mcp-plugins/blob/main/SUPPORT.md

### Suggested review notes

Mailbridge communicates with Mail.app through Apple Events and runs locally over STDIO. It does not access provider credentials or Mail's private database. Direct server registrations default to read-only. Marketplace plugins use prompted mode: every outbound message is gated by a form that presents the exact account, recipients, subject, and body. Release verification uses deterministic fakes and never sends real mail.

## Demo script (30–45 seconds)

1. Show several accounts configured in Mail.app.
2. Ask: “Read my latest three Inbox messages across configured accounts.”
3. Ask: “Reply to the latest message from Alex and say thanks.”
4. Pause on the exact-content confirmation form.
5. Confirm and show the accepted-for-sending result.
6. End on the repository URL and pinned install commands.

Avoid implying provider delivery: Mailbridge reports that Mail.app accepted a message for sending, not that the provider or recipient delivered it.

## Manual launch checklist

- Upload `.github/assets/mailbridge-social-preview.png` under GitHub repository **Settings → General → Social preview**.
- Add a concise repository description and topics such as `apple-mail`, `mcp`, `codex`, `claude-code`, `macos`, and `local-first`.
- Add the landing-page URL to the repository website field when one exists.
- Record and embed the demo near the top of the root README.
- Submit to appropriate plugin and MCP directories using the fields above.
- Recruit a small macOS beta group and track successful first search without maintainer help.
