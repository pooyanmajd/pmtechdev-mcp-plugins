import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { MailbridgeConfig } from "../config.js";
import type { LocalPreferencesContext } from "../local-config.js";
import type { MailBridge } from "../mail/bridge.js";
import { outboundPreviewMessage } from "./outbound-preview.js";
import { toolOutputSchema } from "./schemas.js";
import { MailbridgeToolService } from "./service.js";
import { TOOL_DEFINITIONS } from "./tool-definitions.js";

export interface CreateMailbridgeServerOptions {
  readonly localPreferencesContext?: LocalPreferencesContext;
}

export const SERVER_INFO = Object.freeze({
  name: "mailbridge-mcp",
  version: "0.5.0",
});

export function createMailbridgeServer(
  bridge: MailBridge,
  config: MailbridgeConfig,
  options?: CreateMailbridgeServerOptions,
): McpServer {
  const server = new McpServer(SERVER_INFO, {
    capabilities: {
      tools: {},
    },
  });
  const service = new MailbridgeToolService(
    bridge,
    config,
    async (confirmation) => {
      const result = await server.server.elicitInput({
        mode: "form",
        message: outboundPreviewMessage(confirmation),
        requestedSchema: {
          type: "object",
          properties: {
            approve: {
              type: "boolean",
              title: confirmation.kind === "message" ? "Send" : "Send reply",
              description:
                confirmation.kind === "message"
                  ? "Sends this exact message through Mail. You can't undo it."
                  : "Sends this reply through Mail with the sender, recipients, and message shown. Mail generates the reply subject. You can't undo it.",
            },
          },
          required: ["approve"],
        },
      });
      return result.action === "accept" && result.content?.approve === true;
    },
    options?.localPreferencesContext,
  );

  for (const definition of TOOL_DEFINITIONS) {
    if (!definition.allowedModes.includes(config.mode)) continue;
    server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema,
        outputSchema: toolOutputSchema,
        annotations: definition.annotations,
        ...(definition._meta === undefined ? {} : { _meta: definition._meta }),
      },
      async (input) => service.invoke(definition.name, input),
    );
  }

  return server;
}

export { MailbridgeToolService } from "./service.js";
export type { ConfirmMailSend, MailSendConfirmation } from "./service.js";
export { TOOL_DEFINITIONS } from "./tool-definitions.js";
