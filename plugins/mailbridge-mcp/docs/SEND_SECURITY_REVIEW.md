# Send capability design and security review

## Decision

Mailbridge 0.2 adds two single-message operations:

- `mail_send_message` creates and submits one new message.
- `mail_send_reply` creates and submits one reply or reply-all for a selected message.

Both operations are attachment-free and atomic at the Mailbridge dispatcher boundary. Mailbridge still cannot send an existing editable draft, a forward, an attachment, or a batch.

## Why the boundary is narrow

Mail.app's public scripting dictionary exposes a `send` command for an outgoing message, but its outgoing-message class does not expose a complete, stable attachment inventory. Mailbridge therefore cannot prove that an arbitrary draft still matches a prior approval after a user, plugin, or Mail.app edit. Sending such a draft would turn an opaque draft ID into authority over unreviewed content.

The accepted design constructs the outgoing object from validated input and calls Mail's `send` command in the same fixed JXA operation. No API accepts attachment bytes or paths. Reply sending uses Mail's reply constructor for thread and recipient resolution, replaces its content with exactly the approved body, and refuses to send unless Mail's resolved To/CC/BCC sets exactly match the approved expected recipients. Forward sending is excluded because forwards may carry source attachments.

## Authorization gates

All gates must pass:

1. `MAILBRIDGE_MODE=send`. The historical `full` mode remains unable to send, preventing a privilege increase on upgrade.
2. `MAILBRIDGE_ALLOWED_ACCOUNTS` is non-empty. Configuration refuses to start in send mode without it.
3. The selected `from` address belongs to the allowlist and the resolved Mail account.
4. The request contains bounded recipients, a substantive body, and literal `confirmed: true`. Mailbridge reads the constructed outgoing subject/body back before submission and refuses changed content. Replies additionally carry the exact expected recipient sets, checked immediately before submission.
5. Agent guidance requires the exact sender, To/CC/BCC recipients, subject, reply-all state, and complete body to be shown and explicitly approved before `confirmed` is set.

The runtime can enforce structural confirmation but cannot prove human comprehension. A compromised or over-privileged MCP host remains outside the containment claim and is disclosed as a trust boundary.

## Threat analysis

| Threat | Control | Residual risk |
| --- | --- | --- |
| Existing installations gain send authority on upgrade | Only the new `send` mode enables sending; `full` remains non-send | An administrator can deliberately change the mode |
| Wrong account or reply target sends the message | Mandatory address allowlist, opaque account ID, account/address resolution, ambiguity failure, exact expected-recipient comparison immediately before reply submission | Mail.app account configuration can change between calls |
| Prompt-injected email triggers a send | Message content is untrusted; send tools require separate exact-content approval and confirmation | A compromised host or policy-ignoring agent can misuse granted authority |
| Content changes after approval | No send-draft operation; outgoing object is built atomically and its subject/body are read back before submission | Mail.app/provider processing after acceptance is outside the boundary |
| Hidden attachment or unreviewed quote is transmitted | New-message input has no attachment field; reply content is replaced with the approved body; forward and draft sending are absent | Mail.app's internal reply behavior is platform-owned and covered by compatibility testing |
| Duplicate send after timeout | Send tools are non-idempotent; ambiguous failures map to `MUTATION_OUTCOME_UNKNOWN`; guidance forbids blind retry | The user may still choose to resend after inspection |
| Bulk spam or accidental fan-out | One message per call, 50 recipients per field, bounded serial queue, no batch tool | A caller can make repeated individually confirmed calls |
| Command/script injection | Fixed dispatcher, strict schemas, bounded JSON over stdin, no source interpolation, minimal child environment | Apple Mail and the trusted host remain privileged components |
| Delivery is overstated | Result says `acceptedForSending`, not delivered; docs explain provider/recipient state is unknown | Provider status can still be misunderstood outside Mailbridge |

## Failure semantics

- `SEND_REJECTED`: Mail synchronously returned false. Mailbridge best-effort discards the unsent object; a new attempt requires renewed review.
- `SEND_CONTENT_CHANGED`: Mail's constructed subject or body differs from the approved input before submission. Mailbridge discards the unsent object.
- `SEND_TARGET_CHANGED`: Mail resolved reply recipients that differ from the approved expected sets. Mailbridge discards the unsent reply and the caller must refresh and re-review the target.
- `MUTATION_OUTCOME_UNKNOWN`: Mail threw during submission, the subprocess timed out, or the outcome otherwise cannot be established. Mailbridge does not delete the possible outbound object and callers must inspect Mail before retrying.
- Pre-send validation, account, and resolution failures retain their stable typed errors and never call `Mail.send`.

## Verification evidence

Deterministic tests cover configuration fail-closed behavior, legacy-mode non-escalation, schemas and annotations, bridge request mapping, fixed-dispatcher confirmation and allowlist checks, successful new-message and reply submission, ambiguous outcome handling, and absence of draft/forward/bulk send operations. CI and release verification compile the JXA source and never automate a real mailbox or send real mail.

## Review conclusion

The capability is acceptable only with the controls above kept together. Adding draft, forward, attachment, or bulk sending—or enabling send from an existing mode—requires a new design and security review.
