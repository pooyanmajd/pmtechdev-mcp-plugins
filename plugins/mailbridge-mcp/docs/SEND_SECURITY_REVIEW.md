# Send capability design and security review

## Decision

Mailbridge 0.2 adds two single-message operations:

- `mail_send_message` creates and submits one new message.
- `mail_send_reply` creates and submits one reply or reply-all for a selected message.

Both operations are attachment-free and atomic at the Mailbridge dispatcher boundary. Mailbridge still cannot send an existing editable draft, a forward, an attachment, or a batch.

The marketplace configuration uses `MAILBRIDGE_MODE=prompted`. In that mode, every send request pauses for MCP form elicitation that shows the exact outbound content and requires the user to accept before Mailbridge enters the send path. The established `send` mode remains available for reviewed direct registrations that use a static account allowlist.

## Why the boundary is narrow

Mail.app's public scripting dictionary exposes a `send` command for an outgoing message, but its outgoing-message class does not expose a complete, stable attachment inventory. Mailbridge therefore cannot prove that an arbitrary draft still matches a prior approval after a user, plugin, or Mail.app edit. Sending such a draft would turn an opaque draft ID into authority over unreviewed content.

The accepted design constructs the outgoing object from validated input and calls Mail's `send` command in the same fixed JXA operation. No API accepts attachment bytes or paths. Reply sending uses Mail's reply constructor for thread and recipient resolution, replaces its content with the approved body, and refuses to send unless Mail's resolved To/CC/BCC sets exactly match the approved expected recipients. When read back, current Mail.app adds one terminal ASCII space to script-created replies; the verifier accepts only that fixed one-character serialization artifact and rejects every other body change. Forward sending is excluded because forwards may carry source attachments.

## Authorization gates

All gates must pass:

1. The mode is either `prompted` or `send`. The historical `full` mode remains unable to send, preventing a privilege increase on upgrade.
2. In prompted mode, the connected MCP client supports form elicitation and the user accepts a fresh confirmation containing the exact sender, To/CC/BCC recipients, subject context, reply-all state where relevant, and complete body. Header values are JSON-encoded, each body line is separately JSON-encoded behind a display-only quote marker, and outgoing subjects containing control, line-separator, or bidirectional formatting characters are rejected. If elicitation is unavailable, declined, cancelled, or fails, Mailbridge never reaches Mail's send operation.
3. In direct send mode, `MAILBRIDGE_ALLOWED_ACCOUNTS` is non-empty; configuration refuses to start without it, and the selected `from` address belongs to that allowlist and the resolved Mail account.
4. The request contains bounded recipients, a substantive body, and literal `confirmed: true`. Mailbridge reads the constructed outgoing subject/body back before submission and refuses changed content. For replies only, it treats one Mail.app-added terminal ASCII space as a deterministic serialization artifact; any other additional, removed, or altered character still fails closed. Replies additionally carry the exact expected recipient sets, checked immediately before submission.
5. Agent guidance requires the exact sender, To/CC/BCC recipients, subject, reply-all state, and complete body to be shown and explicitly approved before `confirmed` is set. Prompted mode adds a server-mediated confirmation; it does not replace this review requirement.

The runtime can enforce structural confirmation but cannot prove human comprehension. A compromised or over-privileged MCP host remains outside the containment claim and is disclosed as a trust boundary.

## Threat analysis

| Threat | Control | Residual risk |
| --- | --- | --- |
| Existing installations gain silent send authority on upgrade | Marketplace prompted mode requires a new per-send client confirmation; `full` remains non-send | A user who accepts a prompt can still authorize the selected send |
| Wrong account or reply target sends the message | Prompted mode shows the exact sender and recipients immediately before send; direct mode uses an address allowlist; both use opaque IDs, account/address resolution, ambiguity failure, and exact expected-recipient comparison immediately before reply submission | Mail.app account configuration can change between calls |
| Prompt-injected email triggers a send | Message content is untrusted; agents must obtain prior exact-content approval, and prompted mode renders untrusted headers and every body line in an unambiguous quoted representation that cannot forge the prompt's trusted labels or delimiters | A compromised host can lie about, truncate, or suppress client-side review |
| Content changes after approval | No send-draft operation; outgoing object is built atomically and its subject/body are read back before submission. Reply verification permits only Mail.app's fixed terminal ASCII-space serialization | Mail.app/provider processing after acceptance is outside the boundary |
| Hidden attachment or unreviewed quote is transmitted | New-message input has no attachment field; reply content is replaced with the approved body; forward and draft sending are absent | Mail.app's internal reply behavior is platform-owned and covered by compatibility testing |
| Duplicate send after timeout | Send tools are non-idempotent; ambiguous failures map to `MUTATION_OUTCOME_UNKNOWN`; guidance forbids blind retry | The user may still choose to resend after inspection |
| Bulk spam or accidental fan-out | One message per call, 50 recipients per field, bounded serial queue, no batch tool | A caller can make repeated individually confirmed calls |
| Command/script injection | Fixed dispatcher, strict schemas, bounded JSON over stdin, no source interpolation, minimal child environment | Apple Mail and the trusted host remain privileged components |
| Delivery is overstated | Result says `acceptedForSending`, not delivered; docs explain provider/recipient state is unknown | Provider status can still be misunderstood outside Mailbridge |

## Failure semantics

- `SEND_REJECTED`: Mail synchronously returned false. Mailbridge best-effort discards the unsent object; a new attempt requires renewed review.
- `SEND_CONTENT_CHANGED`: Mail's constructed subject or body differs from the approved input before submission, other than Mail.app's fixed terminal ASCII-space serialization for replies. Mailbridge discards the unsent object.
- `SEND_TARGET_CHANGED`: Mail resolved reply recipients that differ from the approved expected sets. Mailbridge discards the unsent reply and the caller must refresh and re-review the target.
- `MUTATION_OUTCOME_UNKNOWN`: Mail threw during submission, the subprocess timed out, or the outcome otherwise cannot be established. Mailbridge does not delete the possible outbound object and callers must inspect Mail before retrying.
- Pre-send validation, account, and resolution failures retain their stable typed errors and never call `Mail.send`.

## Verification evidence

Deterministic tests cover configuration fail-closed behavior, legacy-mode non-escalation, prompted confirmation acceptance, decline and unavailable-client failures, prompt-spoofing attempts in reply subjects and bodies, schemas and annotations, bridge request mapping, fixed-dispatcher prompted and allowlisted send checks, successful new-message and reply submission, ambiguous outcome handling, and absence of draft/forward/bulk send operations. CI and release verification compile the JXA source and never automate a real mailbox or send real mail.

## Review conclusion

The capability is acceptable only with the controls above kept together. Adding draft, forward, attachment, or bulk sending—or weakening the prompted confirmation or allowlisted direct-send paths—requires a new design and security review.

## Addendum: local access-preferences tools

`mailbridge_get_access_preferences`/`mailbridge_set_access_preferences` and their backing local file (`src/local-config.ts`) are a new *configuration source*, not a new *authority*: they feed the same unmodified `loadConfig` validation and runtime enforcement above, an explicit environment variable still always wins, and `mailbridge_set_access_preferences` requires the same shown-and-approved-then-`confirmed: true` pattern as the send tools, independent of MCP elicitation. Saving preferences never affects the currently running process. Does not change the review conclusion.
