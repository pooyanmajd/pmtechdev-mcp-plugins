# Send capability design and security review

## Decision

Mailbridge 0.2 adds two single-message operations:

- `mail_send_message` creates and submits one new message.
- `mail_send_reply` creates and submits one reply or reply-all for a selected message.

Both operations are attachment-free and atomic at the Mailbridge dispatcher boundary. Mailbridge still cannot send an existing editable draft, a forward, an attachment, or a batch.

The marketplace configuration uses `MAILBRIDGE_MODE=prompted`. In that mode, every send request pauses for MCP form elicitation that shows the exact sender, recipients, message body, and either the new-message subject or the source subject used as reply context. Mail generates the actual reply subject. The user must accept before Mailbridge enters the send path. The established `send` mode remains available for reviewed direct registrations that use a static environment-origin account allowlist.

Native reviews use an explicit five-minute human-review deadline, separate from Mail automation timeouts. The dialog displays this limit. Expiry returns `CONFIRMATION_TIMEOUT`, never invokes a mutation, and cannot be revived by a late acceptance. There is no automatic retry. Regression tests cover acceptance after 107 seconds and late acceptance after the five-minute deadline for both send tools and native preference saves.

## Why the boundary is narrow

Mail.app's public scripting dictionary exposes a `send` command for an outgoing message, but its outgoing-message class does not expose a complete, stable attachment inventory. Mailbridge therefore cannot prove that an arbitrary draft still matches a prior approval after a user, plugin, or Mail.app edit. Sending such a draft would turn an opaque draft ID into authority over unreviewed content.

The accepted design constructs the outgoing object from validated input and calls Mail's `send` command in the same fixed JXA operation. No API accepts attachment bytes or paths. Reply sending uses Mail's reply constructor for thread and recipient resolution, replaces its content with the approved body, and refuses to send unless Mail's resolved To/CC/BCC sets exactly match the approved expected recipients. When read back, current Mail.app adds one terminal ASCII space to any script-created outgoing message, new or reply; the verifier accepts only that fixed one-character serialization artifact and rejects every other body change. Forward sending is excluded because forwards may carry source attachments.

## Authorization gates

All gates must pass:

1. The mode is either `prompted` or `send`. The historical `full` mode remains unable to send, preventing a privilege increase on upgrade.
2. In prompted mode, the connected MCP client supports form elicitation and the user accepts a fresh confirmation containing the exact sender, To/CC/BCC recipients, new-message subject or reply-to subject context, reply-all state where relevant, and complete body. Ordinary values stay readable in labeled rows; values containing controls, newlines, or header-impersonating prefixes are JSON-encoded, and every body line stays behind a display-only marker. Outgoing new-message subjects containing control, line-separator, or bidirectional formatting characters are rejected. If elicitation is unavailable, declined, cancelled, or fails, Mailbridge never reaches Mail's send operation.
3. In direct send mode, both `MAILBRIDGE_MODE=send` and a non-empty `MAILBRIDGE_ALLOWED_ACCOUNTS` must originate in the environment; configuration refuses to start without the latter, and the selected `from` address belongs to that allowlist and the resolved Mail account. A model-writable local preference file cannot complete this authority.
4. The request contains bounded recipients, a substantive body, and literal `confirmed: true`. For new messages, Mailbridge reads the constructed outgoing subject and body back before submission. For replies, it reads the exact body back and checks the exact expected recipient sets immediately before submission; Mail owns the generated reply subject. The verifier accepts one Mail.app-added terminal ASCII space as the only deterministic body serialization artifact and fails closed on every other body change.
5. In prompted mode, `confirmed: true` means the fields are ready for a server-owned final review. A complete send instruction opens one native form containing those exact fields; accepting the native Continue action is final approval, and Skip cancels. There is no extra checkbox or preliminary chat-approval round trip. Direct send mode still requires the exact sender, recipients, subject context, reply-all state, and body to be shown and approved in chat before the flag is set.

The runtime can enforce structural confirmation but cannot prove human comprehension. A compromised or over-privileged MCP host remains outside the containment claim and is disclosed as a trust boundary.

## Threat analysis

| Threat | Control | Residual risk |
| --- | --- | --- |
| Existing installations gain silent send authority on upgrade | Marketplace prompted mode requires a new per-send client confirmation; `full` remains non-send | A user who accepts a prompt can still authorize the selected send |
| Wrong account or reply target sends the message | Prompted mode shows the exact sender and recipients immediately before send; direct mode uses an address allowlist; both use opaque IDs, account/address resolution, ambiguity failure, and exact expected-recipient comparison immediately before reply submission | Mail.app account configuration can change between calls |
| Prompt-injected email triggers a send | Message content is untrusted; agents must obtain exact-content approval through the native form in prompted mode or chat in direct send mode, and prompted mode renders untrusted headers and every body line in an unambiguous quoted representation that cannot forge the prompt's trusted labels or delimiters | A compromised host can lie about, truncate, or suppress client-side review |
| Content changes after approval | No send-draft operation; the outgoing object is built atomically. New-message subject/body and reply body/recipients are read back before submission. Verification permits only Mail.app's fixed terminal ASCII-space body serialization | Mail generates reply subjects; Mail.app/provider processing after acceptance is outside the boundary |
| Hidden attachment or unreviewed quote is transmitted | New-message input has no attachment field; reply content is replaced with the approved body; forward and draft sending are absent | Mail.app's internal reply behavior is platform-owned and covered by compatibility testing |
| Duplicate send after timeout | Send tools are non-idempotent; ambiguous failures map to `MUTATION_OUTCOME_UNKNOWN`; guidance forbids blind retry | The user may still choose to resend after inspection |
| Bulk spam or accidental fan-out | One message per call, 50 recipients per field, bounded serial queue, no batch tool | A caller can make repeated individually confirmed calls |
| Command/script injection | Fixed dispatcher, strict schemas, bounded JSON over stdin, no source interpolation, minimal child environment | Apple Mail and the trusted host remain privileged components |
| Delivery is overstated | Result says `acceptedForSending`, not delivered; docs explain provider/recipient state is unknown | Provider status can still be misunderstood outside Mailbridge |

## Failure semantics

- `SEND_REJECTED`: Mail synchronously returned false. Mailbridge best-effort discards the unsent object; a new attempt requires renewed review.
- `SEND_CONTENT_CHANGED`: Mail's constructed subject or body differs from the approved input before submission, other than Mail.app's fixed terminal ASCII-space serialization. Mailbridge discards the unsent object.
- `SEND_TARGET_CHANGED`: Mail resolved reply recipients that differ from the approved expected sets. Mailbridge discards the unsent reply and the caller must refresh and re-review the target.
- `MUTATION_OUTCOME_UNKNOWN`: Mail threw during submission, the subprocess timed out, or the outcome otherwise cannot be established. Mailbridge does not delete the possible outbound object and callers must inspect Mail before retrying.
- Pre-send validation, account, and resolution failures retain their stable typed errors and never call `Mail.send`.

## Verification evidence

Deterministic tests cover configuration fail-closed behavior, legacy-mode non-escalation, prompted confirmation acceptance, decline and unavailable-client failures, prompt-spoofing attempts in reply subjects and bodies, schemas and annotations, bridge request mapping, fixed-dispatcher prompted and allowlisted send checks, successful new-message and reply submission, ambiguous outcome handling, and absence of draft/forward/bulk send operations. CI and release verification compile the JXA source and never automate a real mailbox or send real mail.

## Review conclusion

The capability is acceptable only with the controls above kept together. Adding draft, forward, attachment, or bulk sending—or weakening the prompted confirmation or allowlisted direct-send paths—requires a new design and security review.

## Addendum: local access-preferences tools

`mailbridge_get_access_preferences`/`mailbridge_set_access_preferences` and their backing local file (`src/local-config.ts`) are a new *configuration source*, not a new *authority*: they feed the same unmodified `loadConfig` validation and runtime enforcement above, and an explicit environment variable still always wins. Saving preferences never affects the currently running process.

The host capability handshake selects the access-preferences interface. MCP Apps clients receive a read-only review tool plus an app-only commit tool. The proposal's random identifier appears only in private result `_meta`; the card displays the exact mode and complete account list, then Save calls the commit tool with that identifier. The card locks the first complete proposal so later host updates cannot substitute different reviewed fields. Proposal storage is capped at six, expires at ten minutes, and evicts only on insertion. Commits are serialized and idempotent.

Without MCP Apps, the same public tool is advertised as a local replacement mutation and the app-only finalizer is not registered. It uses native form elicitation to display the exact mode, complete account list, capabilities, timing, and applicable warnings. Only acceptance commits that in-memory proposal; decline, cancellation, unavailable forms, or failures save nothing. The legacy `confirmed` flag never grants approval. The form and send confirmations share a bounded queue separate from Mail automation.

Both paths exclude `send`, and the local file cannot supply direct-send mode or its allowlist. Those remain environment-origin configuration. Apps visibility and private `_meta` require a compliant, trusted host; they do not protect against a compromised host. A card save timeout is explicitly uncertain, does not trigger an automatic retry, and does not claim cancellation undid a possible write.

## Addendum: 0.5.0 host-agnostic preview, account scope, and Grok

`mail_preview_outbound` is a **review surface**, not a new authority. It renders the same Gmail-style card prompted elicitation shows. Ordinary header values display unquoted so the dialog is readable; values with control characters, newlines, or header-impersonating prefixes (`From:`, `Subject:`, …) still JSON-encode. Reply cards label the source subject as `Reply to` and state that Mail generates the actual reply subject; the sender, recipients, and message remain exact. Calling preview does not authorize a send. Prompted mode still requires host form elicitation; `send` mode still requires a human-set environment allowlist. A model can call preview and then lie that the user approved — that residual risk is unchanged from `confirmed: true` and is why elicitation / env-only `send` remain the gates.

`mail_search_messages` without an account ID, mailbox ID, or allowlist now fails with `ACCOUNT_SCOPE_REQUIRED` when more than one account is visible. An explicit mailbox ID already contains and validates its owning account scope. When a search is truly unscoped and exactly one account is visible, its opaque ID is pinned into the subsequent search so an account appearing between the visibility check and search cannot widen scope. This is a confidentiality control against accidental work/personal crossover into the model, not an authorization token.

The local preferences **file schema** now rejects `send` on both read and write. A hand-edited `mode: "send"` file is ignored, and a saved local account list is never overlaid when the environment selects `MAILBRIDGE_MODE=send`. Combined with the tool already refusing `send`, the only way to start in direct send mode is `MAILBRIDGE_MODE=send` plus a non-empty `MAILBRIDGE_ALLOWED_ACCOUNTS` in the environment.

Grok packaging is local STDIO (Grok CLI / Grok Build) only. A grok.com custom connector would require a public HTTP URL or tunnel; that remains out of scope and is not a weakening of this review.
