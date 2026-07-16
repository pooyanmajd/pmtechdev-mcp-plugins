# Mailbridge MCP

![Mailbridge MCP](assets/logo.svg)

Mailbridge MCP is a local, safety-first [Model Context Protocol](https://modelcontextprotocol.io/) server and Codex plugin for the accounts already configured in macOS Mail. One connection can search and read multiple accounts, prepare drafts, and update read or flagged state. Version 0.1 deliberately cannot send email.

Mailbridge is an independent open-source project. It is not affiliated with, endorsed by, or sponsored by Apple Inc., OpenAI, Google, or any email provider. “Apple,” “macOS,” and “Mail” are trademarks of their respective owners.

> [!IMPORTANT]
> The default mode is read-only. Mail content is untrusted input. Review targets and content before enabling state changes or creating drafts.

## Why Mailbridge

- Use every email account Mail.app already knows without storing provider passwords or OAuth tokens.
- Keep MCP traffic on the local machine over STDIO; no hosted relay, telemetry, or analytics.
- Search message metadata first, then retrieve a full message only when needed.
- Select accounts and mailboxes using opaque IDs returned by the bridge.
- Bound search counts, body sizes, attachment metadata, automation time, and response sizes.
- Create editable drafts without exposing any send operation.
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

See [Architecture](docs/ARCHITECTURE.md) for data flow, trust boundaries, and design rationale.

## Security model

- **Local transport:** the server exposes STDIO only and has no application telemetry.
- **Least privilege:** it uses Mail.app's public automation interface and does not read Mail's private database or request Full Disk Access.
- **Safe default:** `MAILBRIDGE_MODE` defaults to `read-only`.
- **No send surface:** v0.1 can create drafts but does not register or dispatch a send operation because Mail's public automation API cannot reliably verify every attachment before sending.
- **No arbitrary automation:** callers choose only from fixed, validated tools; arbitrary AppleScript/JXA execution is out of scope.
- **Untrusted-content guidance:** tool descriptions and the bundled skill tell agents to treat email bodies, headers, links, and attachment names as data rather than instructions. This guidance reduces risk but is not a server-enforced prompt-injection guarantee.
- **Bounded work:** hard limits and subprocess timeouts reduce accidental resource exhaustion.

Read the workspace [Security](../../SECURITY.md), [Privacy](../../PRIVACY.md), and [Terms](../../TERMS.md) before enabling write capabilities.

## Requirements

- macOS with Mail.app
- At least one account configured and working in Mail.app
- Node.js 20 or newer
- npm
- An MCP client that supports local STDIO servers; the included plugin metadata targets Codex

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

Review [`skills/mailbridge/SKILL.md`](skills/mailbridge/SKILL.md) before installing it. Generic MCP clients do not consume Codex skills; Mailbridge therefore repeats the essential untrusted-content warnings in its tool descriptions.

## Install as a Codex plugin

This plugin directory contains a complete payload: `.codex-plugin/plugin.json`, `.mcp.json`, the bundled `mailbridge` skill, local assets, the committed production runtime under `dist/`, and the fixed dispatcher at `runtime/mailbridge.jxa.js`. Plugin users do not need to install npm dependencies or build source. `.mcp.json` launches `node ./dist/cli.js` with the plugin root as its working directory in read-only mode.

> [!CAUTION]
> Install Mailbridge only in a trusted Codex or MCP host. The host process receives macOS Automation authority for Mail, so a compromised host can exceed Mailbridge's own tool policy. Selected mail content and tool results may also be sent to the model provider configured in the host. For sensitive mail, prefer a suitably governed or local model, keep `read-only` mode, and configure `MAILBRIDGE_ALLOWED_ACCOUNTS` through a reviewed custom MCP registration.

The repository root is the published PMTechDev marketplace. Install the current marketplace snapshot with:

```bash
codex plugin marketplace add https://github.com/pooyanmajd/pmtechdev-mcp-plugins
codex plugin add mailbridge-mcp@pmtechdev
```

For an immutable installation reviewed as Mailbridge `0.1.0`, pin the marketplace to its release tag:

```bash
codex plugin marketplace add pooyanmajd/pmtechdev-mcp-plugins --ref v0.1.0
codex plugin add mailbridge-mcp@pmtechdev
```

Choose one marketplace source for a fresh installation. If `pmtechdev` is already configured from `main`, run `codex plugin marketplace remove pmtechdev` before re-adding the pinned source. Start a new Codex task after installation so the bundled skill and MCP tools load.

The bundled marketplace registration intentionally exposes all accounts configured in Mail.app because no account addresses are known at install time. Users who need account isolation should register the server directly with `MAILBRIDGE_ALLOWED_ACCOUNTS` or maintain a reviewed private marketplace configuration. An allowlist reduces accidental account crossover; it does not replace host trust or model-provider data controls.

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
| `MAILBRIDGE_MODE` | `read-only` (default), `drafts`, `full` | Enables reads only, reads plus draft operations, or all supported operations. |
| `MAILBRIDGE_ALLOWED_ACCOUNTS` | Comma-separated email addresses; unset allows configured accounts | Limits which Mail accounts the bridge exposes. |
| `MAILBRIDGE_MAX_RESULTS` | `25` by default; hard maximum `100` | Caps results returned by message searches. |
| `MAILBRIDGE_MAX_BODY_CHARS` | `100000` by default; hard configuration maximum `500000` | Caps returned message body text. |
| `MAILBRIDGE_TIMEOUT_MS` | `20000` by default; hard maximum `120000` | Caps each macOS automation subprocess in milliseconds. |

Keep secrets out of these variables. Mailbridge never needs an email password, app password, access token, or provider API key.

### Mode capabilities

| Mode | List/search/read/attachments | Change read/flag state | Create drafts | Send, delete, or move mail |
| --- | --- | --- | --- | --- |
| `read-only` (marketplace default) | Yes | No | No | Never |
| `drafts` | Yes | No | Yes | Never |
| `full` | Yes | Yes | Yes | Never |

`full` means all operations that Mailbridge supports; it does not mean unrestricted Mail.app access. No mode registers sending, deletion, moving, mailbox administration, rule changes, credential access, or arbitrary automation.

## MCP tools

| Tool | Effect | Availability |
| --- | --- | --- |
| `mail_list_accounts` | List allowed Mail accounts and their opaque IDs. | Read-only |
| `mail_list_mailboxes` | List mailboxes for a selected account. | Read-only |
| `mail_search_messages` | Return bounded message metadata plus scan count and an explicit `incomplete` flag. | Read-only |
| `mail_get_message` | Return one selected message, including bounded body content. | Read-only |
| `mail_get_attachment` | Return one selected attachment as bounded base64 content (up to 2 MiB). | Read-only |
| `mail_set_message_state` | Change only read or flagged state for one selected message. | `full` |
| `mail_create_draft` | Create a new editable draft without sending it. | `drafts` / `full` |
| `mail_create_reply_draft` | Create an editable reply draft tied to a message. | `drafts` / `full` |
| `mail_create_forward_draft` | Create an editable forward draft tied to a message. | `drafts` / `full` |

Sending, permanent deletion, mailbox and rule administration, arbitrary scripting, remote hosting, background monitoring, and credential management are intentionally out of scope for v0.1.0.

## Examples with two accounts

Suppose Mail.app contains `personal@example.com` and `work@example.com`. Start by asking Mailbridge to list accounts; then use the returned account ID rather than guessing it.

**Read unread personal mail**

1. Call `mail_list_accounts` and select the entry whose address is `personal@example.com`.
2. Call `mail_search_messages` with that opaque account ID, an unread filter, and a small result limit.
3. Show the returned metadata. If `incomplete=true`, narrow the mailbox, dates, or terms before claiming no match exists.
4. Call `mail_get_message` only for the message the user selects.

**Draft a work reply without sending**

1. Select `work@example.com` through `mail_list_accounts`.
2. Find the message with a bounded `mail_search_messages` call.
3. Read the selected message with `mail_get_message`.
4. Show the proposed recipients, subject, and response text.
5. Call `mail_create_reply_draft`; stop after reporting the created draft.

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
```

CI runs on macOS but never grants Automation permission or touches a live mailbox. Live Mail testing, where available, must be explicitly enabled and must never send, move, delete, or otherwise mutate real messages. Submission-oriented positive and negative scenarios are documented in [Tool test cases](docs/TOOL_TEST_CASES.md).

## Troubleshooting

| Error / symptom | Safe next step |
| --- | --- |
| `UNSUPPORTED_PLATFORM` | Run Mailbridge on macOS. Unit tests remain portable where the project supports them. |
| `AUTOMATION_DENIED` | Enable only the host application's Mail toggle under macOS Automation, then retry. |
| `MAIL_NOT_CONFIGURED` | Add an account to Mail.app and verify that Mail can fetch it. |
| `NOT_FOUND` | Refresh the account/mailbox/message listing; opaque IDs may refer to content no longer available. |
| `AMBIGUOUS_ID` | Narrow by account and mailbox, then select from the returned metadata. |
| `READ_ONLY` | Use read tools, or explicitly restart in `drafts`/`full` mode after reviewing the risk. |
| `TIMEOUT` | Narrow the mailbox, date range, query, or result limit before retrying. |
| `MUTATION_OUTCOME_UNKNOWN` | Inspect Mail.app before retrying; a timed-out draft or state change may have completed. |
| `AUTOMATION_BUSY` | Wait for the queued modifying operation to finish before retrying. |
| `INVALID_INPUT` / `INVALID_CONFIG` | Correct the bounded tool arguments or environment configuration; do not retry unchanged. |
| `ACCOUNT_NOT_ALLOWED` | Select an account in `MAILBRIDGE_ALLOWED_ACCOUNTS`, or deliberately revise the allowlist before restart. |
| `ATTACHMENT_TOO_LARGE` / `RESPONSE_TOO_LARGE` | Request less data; Mailbridge will not bypass its configured limits. |
| `UNSUPPORTED_ATTACHMENT` | Open or export the attachment manually in Mail.app if you trust it. |
| No plugin tools after reinstall | Confirm the installed payload contains `dist/cli.js` and `runtime/mailbridge.jxa.js`, reinstall the plugin entry, and start a new Codex task. |

Errors are intentionally sanitized; tool results do not expose raw scripts, credentials, environment variables, or stack traces.

## Roadmap

- Harden v0.1.x through deterministic conformance, security, and compatibility testing.
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
