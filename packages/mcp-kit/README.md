# @pmtechdev/mcp-kit

Small, integration-neutral safety primitives shared by PMTechDev MCP servers.

```ts
import {
  BoundedSerialQueue,
  buildMinimalChildEnvironment,
  stringifyBoundedJson
} from "@pmtechdev/mcp-kit";
```

## Primitives

- `buildMinimalChildEnvironment()` copies only basic user/locale variables into a child environment and starts with a fixed safe `PATH`. API keys and unrelated host secrets are not inherited.
- `stringifyBoundedJson()` measures the final UTF-8 representation before transport and supports an integration-specific typed error.
- `BoundedSerialQueue` provides a bounded FIFO for mutation or other non-idempotent work.

The kit deliberately does not contain authentication, provider schemas, product policy, or plugin-specific errors. Add an API only when it can serve multiple integrations without weakening their local safety boundary.

```bash
npm run check -w @pmtechdev/mcp-kit
npm run test:coverage -w @pmtechdev/mcp-kit
```
