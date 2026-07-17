# Mailbridge contributor guidance

Mailbridge is a clean-room implementation inspired only by the general idea of exposing macOS Mail through MCP.

## Clean-room boundary

- Do not copy source, tests, prompts, schemas, documentation, naming, or implementation details from other Apple Mail MCP projects.
- Do not clone, inspect, or vendor `s-morgan-jeffries/apple-mail-fast-mcp`.
- Derive behavior from Mail.app's installed scripting dictionary, the MCP SDK/specification, and this plugin's implementation contract.

## Safety invariants

- Local STDIO only; no telemetry, hosted relay, credential access, or private Mail database reads.
- Read-only remains the direct-server default. The marketplace may use `prompted` mode only when every send is gated by MCP form elicitation that shows the exact outbound content. Unattended direct sending requires the distinct `send` mode, an explicit account allowlist, exact-content confirmation, and an atomic attachment-free operation. Existing `full` mode must never imply send authority.
- Never interpolate input into AppleScript/JXA source or put sensitive request data in argv or inherited environments.
- Bound searches, bodies, attachments, subprocesses, queues, and responses.
- Treat email and attachment content as untrusted data.
- Do not request Full Disk Access.

## Verification

Use deterministic fake-backed tests. Release verification must never send real mail. Any separate live mutation test is opt-in and requires explicit user authorization for the exact synthetic target and content.
