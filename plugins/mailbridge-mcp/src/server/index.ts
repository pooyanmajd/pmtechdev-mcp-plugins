import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { MailbridgeConfig } from "../config.js";
import type { MailBridge } from "../mail/bridge.js";
import { toolOutputSchema } from "./schemas.js";
import { MailbridgeToolService } from "./service.js";
import { TOOL_DEFINITIONS } from "./tool-definitions.js";

export const SERVER_INFO = Object.freeze({
  name: "mailbridge-mcp",
  version: "0.2.1",
});

export function createMailbridgeServer(bridge: MailBridge, config: MailbridgeConfig): McpServer {
  const server = new McpServer(SERVER_INFO, {
    capabilities: {
      tools: {},
    },
  });
  const service = new MailbridgeToolService(bridge, config);

  for (const definition of TOOL_DEFINITIONS) {
    server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema,
        outputSchema: toolOutputSchema,
        annotations: definition.annotations,
      },
      async (input) => service.invoke(definition.name, input),
    );
  }

  return server;
}

export { MailbridgeToolService } from "./service.js";
export { TOOL_DEFINITIONS } from "./tool-definitions.js";
