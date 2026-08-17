# Mail.app compatibility

Mailbridge talks to Mail.app only through the public scripting dictionary. CI never grants Automation permission and never opens a live mailbox. Compatibility evidence is therefore split:

| Check | Where it runs | What it proves |
| --- | --- | --- |
| JXA syntax (`node --check` + `osacompile`) | macOS CI | The dispatcher parses as JXA |
| Deterministic fake-backed tests | every `npm test` | Policy, schemas, and dispatcher contracts |
| `scripts/check-mail-compat.mjs` | opt-in, local macOS | This Mac's Mail.app still exposes the required selectors |

## Verified versions

Record live results here after running the checker against a real Mail.app. Do not claim a macOS release is verified until this table has a date.

| macOS | Mail.app | Checker result | Notes | Date |
| --- | --- | --- | --- | --- |
| _unverified_ | _unverified_ | not run in CI | Add a row after a local `node plugins/mailbridge-mcp/scripts/check-mail-compat.mjs` | — |

Known Mail.app serialization artifact (current as of 0.4.0): script-created outgoing bodies gain one trailing ASCII space. The send verifier accepts only that one-character difference.

## How to record a result

On a Mac with Mail configured:

```bash
node plugins/mailbridge-mcp/scripts/check-mail-compat.mjs
```

The script never sends mail. It only asks Mail for its name, version, and whether the public dictionary still mentions `outgoingMessages`, `send`, `reply`, `forward`, `accounts`, `mailboxes`, and `inbox`. Paste the JSON into a PR and add a table row.
