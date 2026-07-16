# Security policy

Mailbridge processes highly sensitive local email. Security reports are welcome and will be handled with care.

## Supported versions

While the project is pre-1.0, only the latest released `0.1.x` version and the current `main` branch receive security fixes. Once a newer patch is available, older patches may no longer be supported.

## Report a vulnerability

Email **pooyanmjd@gmail.com** with the subject `Mailbridge security report`. Do not open a public issue for a suspected vulnerability and do not include real email content, credentials, access tokens, account identifiers, or other people's personal information.

Include, where safe:

- affected version or commit;
- macOS and Node.js versions;
- configuration mode, with secrets and account addresses redacted;
- minimal reproduction using synthetic data;
- expected and observed impact;
- any suggested mitigation.

You should receive an acknowledgement within 7 days. The maintainer will validate the report, coordinate a remediation and disclosure window based on severity, and credit the reporter if requested. This is a best-effort open-source process, not a service-level agreement.

Please act in good faith: avoid accessing other people's data, sending email, changing real mailboxes, degrading services, persistence, or broad automated scanning. Stop once you have enough evidence to report the issue.

## Threat model

| Threat | Boundary / impact | Primary controls |
| --- | --- | --- |
| Malicious email prompt injection | Message content attempts to redirect an agent or exfiltrate data. | Search-before-read, bounded content, explicit untrusted-content guidance in tools and skill, and a fixed tool surface. Guidance reduces risk but is not a server-enforced guarantee. |
| Script injection | Tool arguments alter executable JXA/AppleScript. | Fixed dispatcher; one bounded JSON request via stdin; no input interpolation, request environment values, or request process arguments; schema validation. |
| Unauthorized account access | A caller attempts to enumerate or read a configured but disallowed account. | Optional address allowlist, opaque returned IDs, account-scoped operations, stable denial errors. |
| Accidental mutation | An ambiguous request changes state or creates drafts. | Read-only default, three modes, explicit draft tools, serialized modifications, and outcome-unknown timeout handling. v0.1 has no send tool. |
| Oversized or expensive request | Broad searches, large bodies, attachments, or hung automation exhaust resources. | Hard result maximum, configured caps, subprocess timeout, bounded serialization. |
| Credential disclosure | Errors or diagnostics expose provider secrets. | Mail.app owns authentication; sanitized errors; no credentials accepted or logged by design. |
| Private database access | A component bypasses Mail.app permissions or reads internal storage. | Public Mail automation only; no Full Disk Access requirement; no direct Mail database code. |
| Dependency or release compromise | Published code or packages differ from reviewed source. | Locked dependencies, CI checks, minimal runtime dependencies, pack dry run; signed provenance is planned but not yet claimed. |
| Local malicious process | Another process invokes or replaces the local server. | Out of full control; users must protect their OS account, repository, PATH, Node runtime, and plugin marketplace sources. |

## Security invariants

- STDIO is the only supported transport; the server opens no network listener.
- Read-only mode is the default.
- Mailbridge v0.1 exposes no send operation; users review and send drafts manually in Mail.app.
- Permanent deletion, mailbox/rule administration, arbitrary scripting, private database access, credential management, and background monitoring are out of scope.
- Public errors must not include raw dispatcher source, stack traces, environment values, passwords, tokens, or Mail credentials.
- Normal tests use a fake bridge. Live Mail tests are opt-in and must never send or mutate mail.

## Operational guidance

Review the repository and lockfile before installation. Pin a release or commit. Keep the account allowlist as narrow as practical and remain in read-only mode unless a task specifically requires drafts or state changes. Revoke Automation access under **System Settings → Privacy & Security → Automation** when no longer needed.

See [Architecture](docs/ARCHITECTURE.md) for detailed trust boundaries.
