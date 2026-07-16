# PMTechDev MCP & Plugins security policy

Plugins in this repository can process sensitive connected data. Security reports are welcome and will be handled with care.

## Supported versions

While the workspace is pre-1.0, only the latest release of each plugin and the current `main` branch receive security fixes.

## Report a vulnerability

Email **pooyanmjd@gmail.com** with the subject `PMTechDev plugin security report`. Do not open a public issue or include real connected content, credentials, tokens, private identifiers, or other people's personal information.

Include, where safe:

- affected plugin, version, or commit;
- operating system and Node.js version;
- configuration mode with secrets and identifiers redacted;
- minimal reproduction using synthetic data;
- expected and observed impact;
- any suggested mitigation.

You should receive an acknowledgement within 7 days. This is a best-effort open-source process, not a service-level agreement.

## Threat model

| Threat | Primary controls |
| --- | --- |
| Connected-content prompt injection | Progressive retrieval, bounded content, untrusted-content guidance, fixed tool surfaces, and least-privilege defaults. Guidance reduces risk but is not a server-enforced guarantee. |
| Command or script injection | Structured transports, fixed executables, strict schemas, minimal subprocess environments, and no source interpolation. |
| Unauthorized scope expansion | Allowlists, opaque returned IDs, operation-level scope enforcement, and stable denial errors. |
| Accidental mutation | Read-only defaults, explicit mutation tools, bounded serialization, accurate annotations, and outcome-unknown timeout handling. |
| Oversized or expensive work | Hard limits for searches, bodies, attachments, subprocesses, queues, and responses. |
| Credential disclosure | No credential harvesting; sanitized errors; secrets excluded from argv, inherited environments, logs, fixtures, and artifacts. |
| Dependency or release compromise | Locked dependencies, reproducible committed bundles, catalog validation, package dry-runs, and security review. |

## Repository invariants

- Each plugin documents its transport and remote data destinations; local STDIO is the default.
- Read-only or least-privilege behavior is the default.
- Mutations and open-world effects require explicit tools and accurate annotations.
- Arbitrary scripting, hidden telemetry, credential harvesting, and undocumented monitoring are prohibited.
- Public errors do not include stack traces, environment values, passwords, tokens, private paths, or raw executable source.
- Normal tests use deterministic fakes. Live tests are opt-in and require explicit user scope.

Review the repository and lockfile before installation. Pin a release or commit, enable only the required plugin and resources, and revoke connector or OS permissions when no longer needed.

Mailbridge-specific boundaries are documented in [its architecture guide](plugins/mailbridge-mcp/docs/ARCHITECTURE.md).
