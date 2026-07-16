#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { stringifyBoundedJson } from "@pmtechdev/mcp-kit";
import { z } from "zod";

import { PLUGIN_INFO } from "./info.js";

const server = new McpServer(PLUGIN_INFO, { capabilities: { tools: {} } });
server.registerTool(
  "__PLUGIN_NAME___status",
  {
    title: "__PLUGIN_DISPLAY_NAME__ Status",
    description: "Return local plugin metadata without contacting an external service.",
    inputSchema: z.object({}).strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  () => ({ content: [{ type: "text", text: stringifyBoundedJson(PLUGIN_INFO, 4_096) }] })
);

await server.connect(new StdioServerTransport());
