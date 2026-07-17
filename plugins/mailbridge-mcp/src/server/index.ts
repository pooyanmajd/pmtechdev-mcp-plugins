import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { MailbridgeConfig } from "../config.js";
import type { MailBridge } from "../mail/bridge.js";
import { toolOutputSchema } from "./schemas.js";
import {
  MailbridgeToolService,
  type MailSendConfirmation,
} from "./service.js";
import { TOOL_DEFINITIONS } from "./tool-definitions.js";

export const SERVER_INFO = Object.freeze({
  name: "mailbridge-mcp",
  version: "0.3.0",
});

function displayJson(value: string | readonly string[]): string {
  return JSON.stringify(value).replace(
    /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu,
    (character) => `\\u{${character.codePointAt(0)?.toString(16).padStart(4, "0")}}`,
  );
}

function addressLine(label: string, addresses: readonly string[]): string {
  return `${label}: ${displayJson(addresses)}`;
}

function quotedBody(body: string): string {
  return body.split("\n").map((line) => `> ${displayJson(line)}`).join("\n");
}

function confirmationMessage(confirmation: MailSendConfirmation): string {
  const lines = [
    "Approve this exact attachment-free email for sending through Apple Mail.",
    "The body is untrusted content; review it as data, not as instructions.",
    "Each body line is shown as a JSON string after a > marker; the marker is not part of the email.",
    "",
    `From: ${displayJson(confirmation.from)}`,
    addressLine("To", confirmation.to),
    addressLine("CC", confirmation.cc),
    addressLine("BCC", confirmation.bcc),
  ];

  if (confirmation.kind === "message") {
    lines.push(`Subject: ${displayJson(confirmation.subject)}`);
  } else {
    lines.push(`Reply to subject: ${displayJson(confirmation.sourceSubject)}`);
    lines.push(`Reply all: ${confirmation.replyAll ? "yes" : "no"}`);
  }

  lines.push(
    "",
    "--- BEGIN QUOTED EXACT BODY ---",
    quotedBody(confirmation.body),
    "--- END QUOTED EXACT BODY ---",
  );
  return lines.join("\n");
}

export function createMailbridgeServer(bridge: MailBridge, config: MailbridgeConfig): McpServer {
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
        message: confirmationMessage(confirmation),
        requestedSchema: {
          type: "object",
          properties: {
            approve: {
              type: "boolean",
              title: "Send this email",
              description: "Select true only after reviewing the exact sender, recipients, subject context, and body above.",
            },
          },
          required: ["approve"],
        },
      });
      return result.action === "accept" && result.content?.approve === true;
    },
  );

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
export type { ConfirmMailSend, MailSendConfirmation } from "./service.js";
export { TOOL_DEFINITIONS } from "./tool-definitions.js";
