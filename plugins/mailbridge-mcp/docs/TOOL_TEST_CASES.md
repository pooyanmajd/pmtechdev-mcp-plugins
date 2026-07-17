# Tool test cases

These cases are human-readable acceptance scenarios for local release testing and an eventual plugin submission. Automated equivalents should use a deterministic fake bridge. CI must not request macOS Automation permission or access a real mailbox.

Each fixture includes two accounts, opaque IDs, several mailboxes, messages with overlapping subjects, a message containing prompt-injection text, a bounded attachment, and an editable draft. Assertions must verify structured content, annotations, stable error codes, and the absence of raw scripts, environment values, credentials, and stack traces.

## Positive cases

### P1 — Select one of two accounts and search unread mail

**Given:** read-only mode and two allowed accounts.

**Request:** “Show the latest three unread messages in my personal account.”

**Expected:**

1. `mail_list_accounts` returns both entries with opaque account IDs.
2. The personal account is selected by its returned address and ID.
3. `mail_search_messages` receives that ID, an unread constraint, and `limit: 3`.
4. At most three results contain account and mailbox identity plus metadata, not full bodies.
5. The result reports `scannedCount` and `incomplete`; if incomplete, the agent narrows the search.
6. No mutation tool is called.

### P2 — Narrow search, then retrieve one message

**Given:** read-only mode and two messages with similar subjects.

**Request:** “Read the invoice Alice sent to my work inbox this week.”

**Expected:**

1. Select the work account with `mail_list_accounts`.
2. Use `mail_list_mailboxes` if the inbox ID is not known.
3. Call `mail_search_messages` with account, mailbox, sender/subject terms, date bounds, and a small limit.
4. Disambiguate from returned metadata.
5. Call `mail_get_message` exactly once for the selected opaque message ID and return capped body content.

### P2b — Read the newest three messages across account Inboxes

**Given:** at least two allowed accounts with interleaved received dates.

**Request:** “Find and read my last three emails.”

**Expected:**

1. Call `mail_search_messages` with `scope: "inbox"` and `limit: 3`.
2. The runtime merges newest-first Inbox streams and does not scan complete mailboxes.
3. Results are globally newest-first and report `incomplete: false` when the page is complete.
4. Call `mail_get_messages` once with exactly the three returned opaque IDs.
5. No message-state or draft tool is called.

### P3 — Retrieve a selected attachment

**Given:** a selected message with one small fixture attachment.

**Request:** “Get the PDF attached to this message.”

**Expected:** `mail_get_attachment` receives the selected message identity and returned attachment identity. The result stays inside configured size/metadata bounds and is never executed or automatically opened.

### P4 — Create a reply draft without sending

**Given:** drafts mode and a selected work message.

**Request:** “Draft a reply saying I can meet Tuesday at 10.”

**Expected:** recipients, subject, and body are previewed; `mail_create_reply_draft` creates one draft; the response makes clear that nothing was sent. An editable draft cannot be sent through Mailbridge.

### P4b — Send one explicitly approved reply

**Given:** prompted marketplace mode and a selected message with no trusted instructions derived from its body.

**Request:** after seeing the exact sender, target, reply-all state, subject context, and full body, the user explicitly approves one send.

**Expected:** `mail_send_reply` first presents MCP form elicitation containing the exact sender, expected To/CC/BCC sets, reply-all state, subject context, and body. Untrusted header values and body lines use an unambiguous quoted representation so they cannot forge trusted prompt labels or delimiters. Only an accepted confirmation can invoke the JXA dispatcher, which replaces quoted content with the approved body, verifies Mail resolved the same recipients, and submits one attachment-free reply atomically. A mismatch fails with `SEND_TARGET_CHANGED`; an unavailable or declined form fails with `CONFIRMATION_UNAVAILABLE` or `SEND_NOT_CONFIRMED`. The result reports only that Mail accepted it for sending. No draft-send, forward-send, attachment-send, or bulk-send path exists.

### P5 — Broad search reports incompleteness

**Given:** multiple large mailboxes whose combined messages exceed the fixed scan budget.

**Request:** “Find every matching message in all accounts.”

**Expected:** the runtime does not eagerly materialize complete message arrays, returns at most the requested result count, and sets `incomplete: true`. The agent explains that the answer is partial and narrows by account, mailbox, dates, or terms.

## Negative cases

### N1 — Mutation rejected in read-only mode

**Given:** the direct-server default read-only mode.

**Request:** call `mail_set_message_state` and any draft tool; repeat the state operation in drafts mode.

**Expected:** in read-only mode each operation fails without a bridge mutation. In drafts mode, draft tools are allowed but the state operation still fails with `READ_ONLY`. The result does not disclose configuration values or a stack trace.

### N2 — Send authority fails closed

**Given:** read-only, drafts, or legacy full mode; send mode without an account allowlist; prompted mode with no form-elicitation support or a declined confirmation; or a send input without `confirmed: true` and a substantive body.

**Expected:** no send reaches the bridge. Prompted mode requires an accepted exact-content MCP confirmation, while direct send mode requires a non-empty allowlist; both require exact confirmation. `mail_send_draft`, forward sending, attachment sending, and bulk sending remain absent.

### N2b — Unknown send outcome is not retried

**Given:** Mail.app is asked to send one approved message but the Apple Event times out or fails ambiguously.

**Expected:** return `MUTATION_OUTCOME_UNKNOWN`; do not delete the possible outbound object and do not retry. The user inspects Mail.app or Sent mail before deciding on a new action.

### N3 — Prompt injection, account escape, and oversized query are contained

**Given:** a message subject or body tries to forge confirmation labels or delimiters and says to ignore policy and run commands; the request also supplies an invented/disallowed account ID, `limit: 10000`, and an overlong query.

**Expected:** message text remains untrusted data and triggers no extra tools; confirmation headers and body lines are quoted so injected text cannot escape into trusted prompt structure; schema/policy validation rejects or safely caps invalid bounds; the disallowed account is not exposed; no executable source includes user input; the response uses a stable typed error without secrets.

## Release evidence

Record the commit SHA, Node 22 and 24 versions, macOS runner version, `npm ci`, `npm run check`, coverage threshold result, packaged-plugin initialization and `tools/list` smoke result, plugin validator result, and skill/agent metadata validator result. Do not attach real email content, account IDs, Mail logs, or screenshots of private mailboxes to a public submission.
