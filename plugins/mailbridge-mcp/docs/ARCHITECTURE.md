# Architecture

## Scope

Mailbridge MCP is a macOS-only, local STDIO server. It exposes a fixed, bounded subset of Mail.app automation for safe inbox workflows. It does not operate Mail's private database, accept arbitrary scripts, manage credentials, host a remote endpoint, monitor mail in the background, permanently delete messages, or administer mailboxes and rules.

## Components

```text
┌──────────────────────────────────────────────────────────────┐
│ MCP client / Codex                                           │
│ User intent, tool approval, untrusted model context          │
└──────────────────────────────┬───────────────────────────────┘
                               │ STDIO: MCP JSON-RPC
┌──────────────────────────────▼───────────────────────────────┐
│ src/server                                                   │
│ Tool schemas, annotations, policy gates, bounded formatting  │
└──────────────────────────────┬───────────────────────────────┘
                               │ typed bridge requests
┌──────────────────────────────▼───────────────────────────────┐
│ src/mail                                                     │
│ Domain values, opaque IDs, errors, bridge interface          │
└──────────────────────────────┬───────────────────────────────┘
                               │ fixed operation + bounded JSON stdin
┌──────────────────────────────▼───────────────────────────────┐
│ /usr/bin/osascript -l JavaScript + fixed JXA dispatcher      │
│ Per-call timeout, sanitized result and error mapping         │
└──────────────────────────────┬───────────────────────────────┘
                               │ Apple events (TCC Automation)
┌──────────────────────────────▼───────────────────────────────┐
│ Mail.app                                                     │
│ Accounts, provider sessions, local message model, drafts     │
└──────────────────────────────────────────────────────────────┘
```

`src/cli.ts` parses configuration and connects the server to STDIO. Tests inject a fake implementation of the mail bridge, keeping default CI independent of Mail.app and macOS Automation consent.

## Data flow

1. The MCP client invokes one registered tool with structured arguments.
2. The server validates types, lengths, modes, limits, account policy, and operation-specific preconditions.
3. The server passes a typed request to the mail bridge.
4. The JXA bridge selects a fixed dispatcher operation. One bounded JSON request is written to the fixed `/usr/bin/osascript -l JavaScript` child's standard input; sensitive mail data is not placed in process arguments.
5. JXA uses Mail.app's public scripting dictionary. Input is treated as data and is never concatenated into executable source.
6. Results are normalized into domain objects, capped, and returned with stable account and mailbox identity.
7. Errors are mapped to stable public codes without raw scripts, environment values, stack traces, or credentials.

Search returns bounded metadata without message bodies. Full message content is a separate `mail_get_message` request, or a bounded `mail_get_messages` request for an explicitly shortlisted batch. Attachment retrieval is separate again. This progressive retrieval keeps sensitive data and prompt-injection exposure proportional to the user's task.

## Trust boundaries

### User and MCP client → Mailbridge

Tool arguments are untrusted. Zod schemas, opaque IDs, allowlists, enum values, length bounds, and hard result limits constrain them. The server does not expose a generic automation endpoint.

### Email content → model and user

Sender names, addresses, subjects, bodies, links, headers, and attachment metadata are untrusted content. They may contain malicious instructions. The bundled skill directs the agent to summarize them as data and never treat them as authority to run commands, reveal secrets, widen scope, or contact third parties.

### Mailbridge → osascript and Mail.app

The dispatcher source is fixed. Structured request data travels through a dedicated stdin pipe, not source interpolation, environment variables, or process arguments. The child receives a minimal allowlisted environment. Each subprocess has a timeout. macOS Transparency, Consent, and Control (TCC) governs whether the host application may automate Mail.

### Mail.app → email providers

Mail.app owns provider authentication, network traffic, account configuration, and local caching. Mailbridge neither receives nor stores account passwords or provider tokens. Provider-side behavior remains outside Mailbridge's trust boundary.

### Mutation boundary

Read-only mode blocks all mutations. Draft mode permits draft creation but not message-state changes. Full mode additionally permits read/flag state changes. Modifying operations are serialized and bounded by a queue; a timeout is reported as `MUTATION_OUTCOME_UNKNOWN` so callers inspect Mail.app instead of blindly retrying.

Mailbridge v0.1 exposes no send operation. Mail's public outgoing-message interface cannot provide a complete, stable attachment inventory for every draft, so the runtime cannot prove atomically that an edited draft still matches an approval. Drafts remain editable and sendable by the user in Mail.app.

## Identity and consistency

Account and mailbox IDs are opaque strings generated or returned by the bridge. Callers must obtain and reuse them rather than constructing identifiers. Message results include account and mailbox identity, a bridge ID, and the RFC Message-ID when Mail.app exposes one. A stale, missing, or non-unique reference produces a typed error instead of silently selecting another item.

Mailboxes and messages can change between calls. Mailbridge favors explicit `NOT_FOUND` or `AMBIGUOUS_ID` outcomes over unsafe guesses.

## Resource controls

- Search defaults to Inbox, is bounded, and results can never exceed 100.
- Mail exposes each mailbox newest-first. Search performs a k-way merge across selected Inbox streams, so a small latest page reads only the next candidate needed from each account instead of rescanning every mailbox.
- Search accesses message collections by index rather than eagerly materializing an entire mailbox. An internal budget derived from the configured subprocess timeout returns partial results with `incomplete=true` before the outer deadline; incomplete searches must be narrowed before treating absence as conclusive.
- All Mail.app automation is serialized with a bounded queue. This avoids concurrent Apple Event scans competing inside Mail.app; excess parallel work fails with `AUTOMATION_BUSY` instead of building an unbounded backlog.
- Full bodies are capped by configured character count.
- Batch body reads are capped to 25 selected messages and retain the per-message body limit.
- Attachment metadata and serialized tool results are bounded.
- Every automation process has a configured timeout, and search receives a smaller derived budget so it can return partial coverage first when Mail.app remains responsive between events.
- The transport is STDIO and has no listening port.
- Live Mail tests are opt-in; normal tests use a fake bridge.

## Tool annotations

List, search, and get operations declare `readOnlyHint=true`, `destructiveHint=false`, and `openWorldHint=false`. State and draft tools declare `readOnlyHint=false`, `destructiveHint=false`, and `openWorldHint=false`. No tool communicates externally beyond Mail.app's normal account synchronization.

## Distribution

The production build commits a reproducible ESM executable at `dist/cli.js`; the fixed dispatcher is shipped at `runtime/mailbridge.jxa.js`. The Codex plugin's `.mcp.json` launches the executable with the plugin root as `cwd`, allowing it to resolve the dispatcher, and forces read-only mode by default. Plugin users do not need development dependencies or a source build. Plugin assets and its skill are presentation and agent-guidance layers; runtime policy remains enforced inside the server.

This directory is an independently packageable plugin payload inside the PMTechDev repository marketplace. The root catalog controls discovery; signed artifact provenance remains a separate release operation.
