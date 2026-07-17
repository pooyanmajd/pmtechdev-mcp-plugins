# Mailbridge MCP

![Mailbridge MCP](assets/logo.svg)

Mailbridge MCP is a local, safety-first [Model Context Protocol](https://modelcontextprotocol.io/) server and Codex and Claude Code plugin for the accounts already configured in macOS Mail. One connection can search and read multiple accounts, prepare drafts, update read or flagged state, and send confirmed attachment-free messages and replies only after the applicable permission gate is satisfied.

Mailbridge is an independent open-source project. It is not affiliated with, endorsed by, or sponsored by Apple Inc., OpenAI, Google, or any email provider. “Apple,” “macOS,” and “Mail” are trademarks of their respective owners.

> [!IMPORTANT]
> The direct-server default is read-only. The bundled Codex and Claude Code marketplace plugins use `prompted` mode so drafts work immediately and every send requires a fresh client-side confirmation showing the exact outbound content. Allowlisted `send` mode remains available for reviewed direct registrations.

## Why Mailbridge

- Use every email account Mail.app already knows without storing provider passwords or OAuth tokens.
- Keep MCP traffic on the local machine over STDIO; no hosted relay, telemetry, or analytics.
- Search message metadata first, then retrieve a full message only when needed.
- Select accounts and mailboxes using opaque IDs returned by the bridge.
- Bound search counts, body sizes, attachment metadata, automation time, and response sizes.
- Create editable drafts, or explicitly send one reviewed attachment-free message or reply.
- Run deterministic tests against a fake bridge without touching a real mailbox.

## Architecture

The bundled TypeScript MCP server registers a fixed tool surface. Its mail bridge invokes a fixed JXA dispatcher through `/usr/bin/osascript -l JavaScript`, passing one bounded serialized JSON request over the child process's standard input. Sensitive request data is not placed in process arguments, and user or model input is never interpolated into executable source. Mail.app remains responsible for provider authentication and mailbox access.

```text
Codex / MCP client
        │ local STDIO
        ▼
Mailbridge schemas + policy gates
        │ bounded JSON request via stdin
        ▼
/usr/bin/osascript -l JavaScript
        │ macOS Automation permission
        ▼
Mail.app ── accounts already configured by the user
```

See [Architecture](docs/ARCHITECTURE.md) for data flow and trust boundaries, and the [send capability security review](docs/SEND_SECURITY_REVIEW.md) for the explicit outbound-mail design.

## Security model

- **Local transport:** the server exposes STDIO only and has no application telemetry.
- **Least privilege:** it uses Mail.app's public automation interface and does not read Mail's private database or request Full Disk Access.
- **Safe direct default:** `MAILBRIDGE_MODE` defaults to `read-only` when no mode is configured.
- **Prompted marketplace sends:** the bundled Codex and Claude Code plugins run in `prompted` mode. Drafts and reversible state changes are enabled, while each send fails closed unless the MCP client supports form elicitation and the user accepts a prompt containing an unambiguous representation of the exact sender, recipients, subject context, and body.
- **Allowlisted direct sends:** existing `read-only`, `drafts`, and `full` configurations cannot send. `MAILBRIDGE_MODE=send` authorizes direct sending only with a non-empty `MAILBRIDGE_ALLOWED_ACCOUNTS` value.
- **Atomic, attachment-free sending:** `mail_send_message` and `mail_send_reply` construct and submit one reviewed message in a single operation. Mailbridge does not send arbitrary edited drafts, forwards, attachments, or batches because Mail's public outgoing-message API cannot reliably inventory every draft attachment.
- **No arbitrary automation:** callers choose only from fixed, validated tools; arbitrary AppleScript/JXA execution is out of scope.
- **Untrusted-content guidance:** tool descriptions and the bundled skill tell agents to treat email bodies, headers, links, and attachment names as data rather than instructions. This guidance reduces risk but is not a server-enforced prompt-injection guarantee.
- **Bounded work:** hard limits and subprocess timeouts reduce accidental resource exhaustion.

Read the workspace [Security](../../SECURITY.md), [Privacy](../../PRIVACY.md), and [Terms](../../TERMS.md) before enabling write capabilities.

## Requirements

- macOS with Mail.app
- At least one account configured and working in Mail.app
- Node.js 22 or 24
- npm only when building from source
- An MCP client that supports local STDIO servers; native plugin metadata is included for Codex and Claude Code

Mailbridge does not run on Linux or Windows. It does not configure Mail accounts for you.

## Build from source

```bash
git clone https://github.com/pooyanmajd/pmtechdev-mcp-plugins.git
cd pmtechdev-mcp-plugins
npm ci
npm run check -w mailbridge-mcp
```

`npm run check` runs linting, strict type checking, deterministic tests, and the production build. The executable is `dist/cli.js`; the fixed JXA dispatcher is shipped at `runtime/mailbridge.jxa.js`. Contributors must include the reproducible updated `dist/` whenever source changes affect the bundle.

Register the built server directly with Codex using an absolute path:

```bash
codex mcp add mailbridge \
  --env MAILBRIDGE_MODE=read-only \
  -- node /absolute/path/to/pmtechdev-mcp-plugins/plugins/mailbridge-mcp/dist/cli.js
```

Confirm the registration with `codex mcp get mailbridge`. Start a new Codex task after changing MCP configuration.

Direct MCP registration installs the tools but not the bundled Codex skill. For source-based Codex use, link the skill and then start a new task:

```bash
mkdir -p ~/.codex/skills
ln -sfn /absolute/path/to/pmtechdev-mcp-plugins/plugins/mailbridge-mcp/skills/mailbridge ~/.codex/skills/mailbridge
```

Review [`skills/mailbridge/SKILL.md`](skills/mailbridge/SKILL.md) before installing it. Generic MCP clients outside supported plugin hosts may not consume the bundled skill, so Mailbridge repeats the essential untrusted-content warnings in its tool descriptions.

## Install as a Codex plugin

This plugin directory contains a complete payload: the Codex manifest, `.mcp.json`, the bundled `mailbridge` skill, local assets, the committed production runtime under `dist/`, and the fixed dispatcher at `runtime/mailbridge.jxa.js`. Plugin users do not need to install npm dependencies or build source. `.mcp.json` launches `node ./dist/cli.js` with the plugin root as its working directory in `prompted` mode.

Marketplace installation is supported in Codex CLI and for Codex in the ChatGPT desktop app. Plugins are not currently available in the Codex IDE extension. The commands below use Codex CLI; see the official [Codex plugin documentation](https://learn.chatgpt.com/docs/plugins) for other supported installation surfaces.

> [!CAUTION]
> Install Mailbridge only in a trusted Codex or MCP host. The host process receives macOS Automation authority for Mail, so a compromised host can exceed Mailbridge's own tool policy. Selected mail content and tool results may also be sent to the model provider configured in the host. For sensitive mail, prefer a suitably governed or local model, keep `read-only` mode, and configure `MAILBRIDGE_ALLOWED_ACCOUNTS` through a reviewed custom MCP registration.

The repository root is the published PMTechDev marketplace. Install the current marketplace snapshot with:

```bash
codex plugin marketplace add pooyanmajd/pmtechdev-mcp-plugins --ref main
codex plugin add mailbridge-mcp@pmtechdev
```

For an immutable installation reviewed as Mailbridge `0.3.0`, pin the marketplace to its release tag:

```bash
codex plugin marketplace add pooyanmajd/pmtechdev-mcp-plugins --ref v0.3.0
codex plugin add mailbridge-mcp@pmtechdev
```

Choose one marketplace source for a fresh installation. If `pmtechdev` is already configured from `main`, run `codex plugin marketplace remove pmtechdev` before re-adding the pinned source. Start a new Codex task after installation so the bundled skill and MCP tools load.

The bundled marketplace registrations intentionally expose all accounts configured in Mail.app because no account addresses are known at install time. Every marketplace send therefore requires an exact-content client confirmation that includes the selected sender. Users who need static account isolation should register the server directly with `MAILBRIDGE_ALLOWED_ACCOUNTS` or maintain a reviewed private marketplace configuration. An allowlist reduces accidental account crossover; it does not replace host trust or model-provider data controls.

## Install as a Claude Code plugin

The native Claude Code manifest launches the same committed bundle through `CLAUDE_PLUGIN_ROOT`, loads the bundled skill, and selects `MAILBRIDGE_MODE=prompted` so every send requires a fresh exact-content form elicitation. Install the immutable release with:

```bash
claude plugin marketplace add pooyanmajd/pmtechdev-mcp-plugins@v0.3.0
claude plugin install mailbridge-mcp@pmtechdev
```

Run `/reload-plugins` after installation, then use `/mcp` to confirm that the plugin-provided `mailbridge` server connected. The same host-trust, account-isolation, and model-provider cautions described above apply to Claude Code.

For local development, add the local repository root as the marketplace source. Plugin maintainers can validate this payload with:

```bash
python3 /path/to/plugin-creator/scripts/validate_plugin.py .
```

## Allow macOS Automation

On the first real Mail operation, macOS may ask whether the application hosting Mailbridge may control Mail. Approve access only if you initiated the request.

If access was denied:

1. Open **System Settings → Privacy & Security → Automation**.
2. Find the host application that launched Mailbridge (for example, Codex or your terminal).
3. Enable its **Mail** toggle.
4. Retry a read-only operation such as listing accounts.

Do not grant Full Disk Access. Mailbridge does not need it. If no Automation entry appears, run one Mailbridge operation first so macOS can present the consent prompt.

## Configuration

Environment variables are read when the server starts.

| Variable | Values / default | Purpose |
| --- | --- | --- |
| `MAILBRIDGE_MODE` | `read-only` (default), `drafts`, `full`, `prompted`, `send` | Enables reads, drafts, state changes, client-prompted sends, or allowlisted direct sends. |
| `MAILBRIDGE_ALLOWED_ACCOUNTS` | Comma-separated email addresses; unset allows configured accounts | Limits exposed accounts. Required and non-empty in `send` mode. |
| `MAILBRIDGE_MAX_RESULTS` | `25` by default; hard maximum `100` | Caps results returned by message searches. |
| `MAILBRIDGE_MAX_BODY_CHARS` | `100000` by default; hard configuration maximum `500000` | Caps returned message body text. |
| `MAILBRIDGE_TIMEOUT_MS` | `20000` by default; hard maximum `120000` | Caps each macOS automation subprocess in milliseconds. |
| `MAILBRIDGE_SEARCH_BUDGET_MS` | `12000` by default; maximum `min(110000, MAILBRIDGE_TIMEOUT_MS - 20% margin)` | Caps work inside one message search. Raising `MAILBRIDGE_TIMEOUT_MS` alone does not raise this independent search budget. |

Keep secrets out of these variables. Mailbridge never needs an email password, app password, access token, or provider API key.

### Mode capabilities

| Mode | List/search/read/attachments | Change read/flag state | Create drafts | Send new messages/replies |
| --- | --- | --- | --- | --- |
| `read-only` (direct default) | Yes | No | No | No |
| `drafts` | Yes | No | Yes | No |
| `full` | Yes | Yes | Yes | No |
| `prompted` (marketplace default) | Yes | Yes | Yes | Yes, after exact-content MCP elicitation |
| `send` | Yes | Yes | Yes | Yes, confirmed and attachment-free only |

`full` intentionally retains its v0.1 meaning. `prompted` sends only after a compatible MCP client displays and accepts the exact-content confirmation; clients without form elicitation receive `CONFIRMATION_UNAVAILABLE`. The form JSON-encodes untrusted header values and each body line so mail content cannot forge its trusted labels or delimiters. `send` is intended for reviewed direct registrations and requires an explicit account allowlist. No mode permits deletion, moving, mailbox administration, rule changes, credential access, arbitrary automation, bulk sending, forward sending, attachment sending, or sending an arbitrary edited draft.

To enable sending from a reviewed direct MCP registration, restart Mailbridge with both settings:

```bash
MAILBRIDGE_MODE=send
MAILBRIDGE_ALLOWED_ACCOUNTS=sender@example.com
```

Do not put passwords or provider tokens in either value. Before every send call, show the exact recipients, subject, and substantive body to the user and obtain explicit approval. A successful tool result means Mail.app accepted the message for sending; it does not prove provider delivery or recipient receipt.

### Local access preferences

An explicitly set `MAILBRIDGE_MODE` or `MAILBRIDGE_ALLOWED_ACCOUNTS` environment variable always wins. When a variable is left unset, Mailbridge falls back to a local, per-user preferences file at `~/Library/Application Support/mailbridge-mcp/preferences.json` (or under `XDG_CONFIG_HOME` if you set it to an absolute path), written with `0600` permissions and never part of this git repository or the shared plugin package. Use `mailbridge_get_access_preferences` and `mailbridge_set_access_preferences` to read and save it — an assistant using Mailbridge should list your real accounts, ask which to allow and at what mode, and save that choice through these tools rather than editing any configuration file directly. Saving preferences does not change the currently running server; the change takes effect on the next restart or reconnect, and each tool response reports whether an environment variable is shadowing the field you just set.

`mailbridge_set_access_preferences` cannot set `send` mode. A model-supplied `confirmed: true` is not an independently verified human confirmation, so this tool is restricted to `read-only`/`drafts`/`full`/`prompted`; enabling unconfirmed direct sending stays a manual environment-variable change you make yourself (see [Configuration](#configuration) above).

The bundled Codex and Claude Code marketplace manifests hardcode `MAILBRIDGE_MODE=prompted`, so a saved local `mode` only takes effect for registrations that leave that variable unset (for example, a direct MCP registration you control).

## MCP tools

| Tool | Effect | Availability |
| --- | --- | --- |
| `mail_list_accounts` | List allowed Mail accounts and their opaque IDs. | Read-only |
| `mail_list_mailboxes` | List mailboxes for a selected account. | Read-only |
| `mail_search_messages` | Return bounded message metadata, exact/contains subject modes, scan count, coverage and stop diagnostics, plus a continuation cursor when an incomplete scan can resume safely. | Read-only |
| `mail_get_message` | Return one selected message, including bounded body content. | Read-only |
| `mail_get_messages` | Return a bounded batch of selected messages with per-message body caps. | Read-only |
| `mail_get_attachment` | Return one selected attachment as bounded base64 content (up to 2 MiB). | Read-only |
| `mail_set_message_state` | Change only read or flagged state for one selected message. | `full` / `prompted` / `send` |
| `mail_create_draft` | Create a new editable draft without sending it. | `drafts` / `full` / `prompted` / `send` |
| `mail_create_reply_draft` | Create an editable reply draft tied to a message. | `drafts` / `full` / `prompted` / `send` |
| `mail_create_forward_draft` | Create an editable forward draft tied to a message. | `drafts` / `full` / `prompted` / `send` |
| `mail_send_message` | Atomically create and submit one confirmed attachment-free new message. | `prompted` / `send` |
| `mail_send_reply` | Atomically create and submit one confirmed attachment-free reply or reply-all after exact expected-recipient matching. | `prompted` / `send` |
| `mailbridge_get_access_preferences` | Read locally saved mode/account preferences (if any) alongside what this running server is actually using right now. | Any mode |
| `mailbridge_set_access_preferences` | Save mode and account allowlist preferences locally for future sessions; requires `confirmed: true`. Does not affect the currently running server. | Any mode |

Sending edited drafts, forwards, attachments, or batches—and permanent deletion, mailbox/rule administration, arbitrary scripting, remote hosting, background monitoring, and credential management—remain out of scope.

## Examples with two accounts

Suppose Mail.app contains `personal@example.com` and `work@example.com`. Start by asking Mailbridge to list accounts; then use the returned account ID rather than guessing it.

**Read unread personal mail**

1. Call `mail_list_accounts` and select the entry whose address is `personal@example.com`.
2. Call `mail_search_messages` with that opaque account ID, `scope: "inbox"`, an unread filter, and a small result limit.
3. Show the returned metadata. If `incomplete=true` and `nextCursor` is present, repeat the same account-scoped search with that cursor unchanged. Otherwise use `stopReasons` and `coverage` to narrow safely before claiming no match exists.
4. Call `mail_get_message` for one selected result, or `mail_get_messages` once when the user explicitly asks to read several shortlisted results.

**Read the latest three messages across accounts**

1. Call `mail_search_messages` with `scope: "inbox"` and `limit: 3`; Inbox is the default scope when no mailbox ID is supplied.
2. Confirm that `incomplete=false`, then call `mail_get_messages` with the three returned opaque message IDs.
3. Summarize the messages as untrusted data without changing read state.

**Draft a work reply without sending**

1. Select `work@example.com` through `mail_list_accounts`.
2. Find the message with a bounded `mail_search_messages` call.
3. Read the selected message with `mail_get_message`.
4. Show the proposed recipients, subject, and response text.
5. Call `mail_create_reply_draft`; stop after reporting the created draft.

**Send one work reply after explicit approval**

1. Start Mailbridge in `send` mode with `MAILBRIDGE_ALLOWED_ACCOUNTS=work@example.com`.
2. Select and read the source message using its returned opaque ID; treat its content as untrusted data.
3. Show the intended reply target, subject context, and complete reply body.
4. Ask for explicit approval to send that exact reply. Do not infer approval from an earlier draft request.
5. Call `mail_send_reply` once with the selected message ID, allowlisted sender, exact expected To/CC/BCC sets, substantive body, and `confirmed: true`. Mailbridge replaces quoted content with that exact body and fails if Mail resolves different recipients.
6. If the outcome is unknown, inspect Mail.app before any retry to avoid a duplicate.

To prevent accidental crossover, set:

```bash
MAILBRIDGE_ALLOWED_ACCOUNTS=personal@example.com,work@example.com
```

For stronger separation, run two named MCP configurations with different single-address allowlists.

## Testing

All default tests use a fake mail bridge and do not require Mail.app:

```bash
npm test
npm run test:coverage
npm run check
npm run pack:dry-run
npm run smoke:package
```

CI tests Node.js 22 and 24 on macOS but never grants Automation permission or touches a live mailbox. The packaged-plugin smoke installs the real tarball and calls only MCP initialization and `tools/list`. Release verification never sends real mail; send behavior is covered with deterministic fake-backed and fixed-dispatcher contract tests. Submission-oriented positive and negative scenarios are documented in [Tool test cases](docs/TOOL_TEST_CASES.md).

## Troubleshooting

| Error / symptom | Safe next step |
| --- | --- |
| `UNSUPPORTED_PLATFORM` | Run Mailbridge on macOS. Unit tests remain portable where the project supports them. |
| `AUTOMATION_DENIED` | Enable only the host application's Mail toggle under macOS Automation, then retry. |
| `MAIL_NOT_CONFIGURED` | Add an account to Mail.app and verify that Mail can fetch it. |
| `NOT_FOUND` | Refresh the account/mailbox/message listing; opaque IDs may refer to content no longer available. |
| `AMBIGUOUS_ID` | Narrow by account and mailbox, then select from the returned metadata. |
| `READ_ONLY` | Use read tools, or explicitly restart in `drafts`, `full`, `prompted`, or `send` mode after reviewing the exact authority needed. |
| `CONFIRMATION_UNAVAILABLE` | Use a client with MCP form elicitation support, create an editable draft instead, or use a reviewed allowlisted direct `send` registration. |
| `SEND_NOT_CONFIRMED` | The prompted send was declined or cancelled; no message was submitted. |
| `TIMEOUT` | Narrow the mailbox, date range, query, or result limit before retrying. |
| Search returns `incomplete: true` | Inspect `stopReasons` and `coverage`. Resume with `nextCursor` and identical filters when present; otherwise narrow to one account or mailbox. A partial result cannot prove absence. |
| Search returns `cursor_invalidated` | Mailbox ordering changed after the prior page. Restart the same narrowed search once instead of altering or reconstructing the opaque cursor. |
| `MUTATION_OUTCOME_UNKNOWN` | Inspect Mail.app before retrying; a timed-out mutation or send may have completed. Never retry a send blindly. |
| `SEND_REJECTED` | Mail.app confirmed it did not accept the message for sending. Review the account and content before a new attempt. |
| `SEND_CONTENT_CHANGED` | Mail changed the constructed outgoing subject or body before submission. Review Mail settings and do not bypass the check. |
| `SEND_TARGET_CHANGED` | Mail resolved reply recipients that differ from the approved sets. Refresh the message, show the new target, and request fresh approval. |
| `AUTOMATION_BUSY` | Wait for the current Mail automation operation to finish before retrying. |
| `CONFIRMATION_BUSY` | Too many send confirmations are already pending. Wait for one to resolve before requesting another. |
| `INVALID_INPUT` / `INVALID_CONFIG` | Correct the bounded tool arguments or environment configuration; do not retry unchanged. |
| `ACCOUNT_NOT_ALLOWED` | Select an account in `MAILBRIDGE_ALLOWED_ACCOUNTS`, or deliberately revise the allowlist before restart. |
| `ATTACHMENT_TOO_LARGE` / `RESPONSE_TOO_LARGE` | Request less data; Mailbridge will not bypass its configured limits. |
| `UNSUPPORTED_ATTACHMENT` | Open or export the attachment manually in Mail.app if you trust it. |
| No plugin tools after reinstall | Confirm the installed payload contains `dist/cli.js` and `runtime/mailbridge.jxa.js`, reinstall the plugin entry, then start a new Codex task or run `/reload-plugins` in Claude Code. |

Errors are intentionally sanitized; tool results do not expose raw scripts, credentials, environment variables, or stack traces.

## Roadmap

- Harden the explicit send boundary through deterministic conformance, security, and compatibility testing.
- Document verified macOS and Mail.app version coverage.
- Maintain tagged release artifacts with checksums, an SBOM, and signed GitHub provenance attestations.
- Maintain Mailbridge through the published PMTechDev repository marketplace.

Remote MCP hosting, arbitrary automation, private Mail database access, permanent deletion, and bulk mutation are not roadmap goals.

## Project policies

- [Contributing](../../CONTRIBUTING.md)
- [Code of Conduct](../../CODE_OF_CONDUCT.md)
- [Security](../../SECURITY.md)
- [Privacy](../../PRIVACY.md)
- [Terms](../../TERMS.md)
- [Changelog](CHANGELOG.md)
- [Third-party notices](NOTICE)

Mailbridge is available under the [MIT License](LICENSE). Copyright © 2026 PMTechDev / Pooyan Majd.
