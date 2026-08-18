# Mail.app compatibility

Mailbridge talks to Mail.app only through its public scripting dictionary. CI never grants Automation permission and never opens a live mailbox. Compatibility evidence is therefore split:

| Check | Where it runs | What it proves |
| --- | --- | --- |
| JXA syntax (`node --check` + `osacompile`) | macOS CI | The dispatcher parses as JXA |
| Deterministic fake-backed tests | every `npm test` | Policy, schemas, and dispatcher contracts |
| `scripts/check-mail-compat.mjs` | opt-in, local macOS | The installed Mail.app's static `sdef` XML retains the required terms and event codes |

## Verified versions

The checker runs `/usr/bin/sdef /System/Applications/Mail.app`. It does not instantiate Mail, send Apple Events, launch the app, inspect accounts or messages, or require Mail to be configured. Record results here only after running it on the named macOS release.

| macOS | Checker result | Notes | Date |
| --- | --- | --- | --- |
| 26.6.1 (Mail 16.0, build 3864.700.51.1.1) | compatible | Static dictionary: all 10 required terms and event codes present | 2026-08-18 |

Known Mail.app serialization artifact (current as of 0.4.0): script-created outgoing bodies gain one trailing ASCII space. The send verifier accepts only that one-character difference.

## How to record a result

On a Mac with Mail.app installed:

```bash
node plugins/mailbridge-mcp/scripts/check-mail-compat.mjs
```

The script reads the app bundle's static scripting definition and checks canonical names and four-character Apple Event codes for Mailbridge's `send`, `reply`, `forward`, outgoing-message, account, mailbox, and Inbox dependencies. Its JSON contains only stable term labels and pass/fail values; command failures are reduced to a stable reason code. Paste that JSON into a PR and add a table row.
