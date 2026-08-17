# Grok

Mailbridge is a **local STDIO** MCP server. Grok has two different MCP surfaces. Only the local one is in scope.

## Supported: Grok CLI / Grok Build

Grok CLI loads local stdio servers from `grok mcp add`, `config.toml`, project `.mcp.json`, and Grok Build plugins. That is the same trust model as Codex and Claude Code: Mail.app Automation is granted to the host process on your Mac.

### Plugin marketplace (Grok Build)

This repository is a Grok marketplace. The catalog is [`.grok-plugin/marketplace.json`](../.grok-plugin/marketplace.json). After adding the marketplace in Grok Build, install `mailbridge-mcp`. The bundled `.mcp.json` starts `node ./dist/cli.js` in `prompted` mode.

### Direct registration (Grok CLI)

```bash
grok mcp add mailbridge \
  --env MAILBRIDGE_MODE=prompted \
  -- node /absolute/path/to/pmtechdev-mcp-plugins/plugins/mailbridge-mcp/dist/cli.js
```

Confirm with `grok inspect` (or the CLI's MCP list command). Start a new Grok session after changing MCP configuration so the bundled skill and tools load.

### Send confirmation on Grok

Use the same path as Codex and Claude:

1. Call `mail_preview_outbound` and show the returned card in chat.
2. Wait for the user to approve that exact content.
3. Call `mail_send_message` or `mail_send_reply` once.

In `prompted` mode Mailbridge still tries MCP form elicitation. If the Grok surface cannot render the form, the send fails closed with `CONFIRMATION_UNAVAILABLE` or `SEND_NOT_CONFIRMED`. Drafts keep working. Do not tunnel around that. For a surface that never shows the form, the user may add a separate, allowlisted `MAILBRIDGE_MODE=send` registration themselves.

## Not supported: grok.com custom connectors

[Grok.com connectors](https://docs.x.ai/grok/connectors) only accept a **public** Streamable HTTP or SSE URL. Local servers have to be tunneled onto the public internet. Mailbridge will not ship a remote HTTP transport or a tunneling recipe. That would move Mail.app Automation off the local host and onto xAI's connector path.

Do not run Mailbridge behind ngrok, Cloudflare Tunnel, or any other public ingress.

## First-run account allowlist

If Mail.app has more than one account and no allowlist is configured, `mail_search_messages` without `accountId` fails with `ACCOUNT_SCOPE_REQUIRED`. List accounts, ask which to allow, and save them with `mailbridge_set_access_preferences` before a broad search.
