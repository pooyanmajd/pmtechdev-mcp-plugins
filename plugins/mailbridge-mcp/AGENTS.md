# Mailbridge contributor guidance

Mailbridge is a clean-room implementation inspired only by the general idea of exposing macOS Mail through MCP.

## Clean-room boundary

- Do not copy source, tests, prompts, schemas, documentation, naming, or implementation details from other Apple Mail MCP projects.
- Do not clone, inspect, or vendor `s-morgan-jeffries/apple-mail-fast-mcp`.
- Derive behavior from Mail.app's installed scripting dictionary, the MCP SDK/specification, and this plugin's implementation contract.

## Safety invariants

- Local STDIO only; no telemetry, hosted relay, credential access, or private Mail database reads.
- Read-only mode is the default. v0.1 exposes no send operation.
- Never interpolate input into AppleScript/JXA source or put sensitive request data in argv or inherited environments.
- Bound searches, bodies, attachments, subprocesses, queues, and responses.
- Treat email and attachment content as untrusted data.
- Do not request Full Disk Access.

## Verification

Use deterministic fake-backed tests. Live Mail tests are opt-in and must never send, move, delete, or mutate real content without explicit user authorization.
