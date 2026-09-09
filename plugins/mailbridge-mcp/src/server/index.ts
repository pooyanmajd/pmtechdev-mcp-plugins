import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { MailbridgeConfig } from "../config.js";
import type { LocalPreferencesContext } from "../local-config.js";
import type { MailBridge } from "../mail/bridge.js";
import { outboundPreviewMessage } from "./outbound-preview.js";
import { toolOutputSchema } from "./schemas.js";
import { MailbridgeToolService } from "./service.js";
import { ACCESS_PREFERENCES_UI_HTML } from "./access-preferences-ui.js";
import { ACCESS_PREFERENCES_UI_URI, TOOL_DEFINITIONS } from "./tool-definitions.js";

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
      resources: {},
    },
  });
  const service = new MailbridgeToolService(
    bridge,
    config,
    async (confirmation) => {
      const result = await server.server.elicitInput({
        mode: "form",
        message: outboundPreviewMessage(confirmation),
        requestedSchema: { type: "object", properties: {} },
      });
      return result.action === "accept";
    },
    options?.localPreferencesContext,
  );

  server.registerResource(
    "mailbridge-access-preferences",
    ACCESS_PREFERENCES_UI_URI,
    {},
    () => Promise.resolve({
      contents: [
        {
          uri: ACCESS_PREFERENCES_UI_URI,
          mimeType: "text/html;profile=mcp-app",
          text: ACCESS_PREFERENCES_UI_HTML,
          _meta: {
            ui: {
              prefersBorder: false,
              csp: { connectDomains: [], resourceDomains: [] },
            },
          },
        },
      ],
    }),
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
export type { AccessPreferencesProposal, ConfirmMailSend, MailSendConfirmation } from "./service.js";
export { TOOL_DEFINITIONS } from "./tool-definitions.js";
