# __PLUGIN_DISPLAY_NAME__

Generated from the PMTechDev MCP plugin template. Replace this introduction with the integration's concrete scope, authentication model, tools, safety boundaries, and verification evidence before publishing it.

Before publication, document:

- the data flow, trust boundaries, host authority, and every remote destination;
- authentication ownership, minimum permissions, allowlists, and revocation;
- how connected content is treated as untrusted data;
- hard bounds for searches, records, content, subprocesses, queues, and responses;
- every mutation, its approval and retry semantics, and whether outcomes can be uncertain;
- what the MCP client or model provider may receive and retain;
- deterministic fake-backed tests plus the exact opt-in boundary for live tests.

Sending, deletion, credential access, remote hosting, and bulk mutation require a dedicated design and security review; they must not appear as an incidental extension of a starter plugin.

```bash
npm run check -w __PLUGIN_NAME__
```
