# Mailbridge MCP contributor guidance

This repository is a clean-room implementation inspired only by the general idea of exposing macOS Mail through MCP.

## Clean-room boundary

- Do not copy source, tests, prompts, schemas, documentation, naming, or implementation details from other Apple Mail MCP projects.
- Do not clone, inspect, or vendor the linked `s-morgan-jeffries/apple-mail-fast-mcp` repository.
- Derive behavior from Apple Mail's installed scripting dictionary, the MCP specification/SDK, and this repository's own design contract.

## Safety invariants

- Local STDIO only. No telemetry, analytics, remote service, or hidden network access.
- Read-only mode is the default.
- v0.1 exposes no sending operation; drafts must be sent manually in Mail.app.
- Never interpolate model/user input into AppleScript/JXA source or place sensitive request data in process arguments or environment variables. Pass bounded serialized input through stdin.
- Bound searches, message bodies, attachment metadata, subprocess timeouts, and response sizes.
- Treat email bodies and attachments as untrusted content.
- Do not request Full Disk Access or read Mail's private database.
- Do not expose passwords, tokens, or Mail account credentials.

## Working in parallel

- Other agents may be editing the repository. Stay within the files assigned in your worker packet.
- Do not revert unrelated changes. Adapt to shared types/contracts and report conflicts.
- Do not publish, push, create GitHub repositories, install globally, or mutate real mailboxes.

## Verification

Prefer deterministic unit tests with a fake bridge. Live Mail tests must be opt-in and must never send, move, delete, or mutate messages.
