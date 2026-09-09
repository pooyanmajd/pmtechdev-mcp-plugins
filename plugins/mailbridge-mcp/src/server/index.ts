import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { MailbridgeConfig } from "../config.js";
import type { LocalPreferencesContext } from "../local-config.js";
import type { MailBridge } from "../mail/bridge.js";
import { outboundPreviewMessage } from "./outbound-preview.js";
import { toolOutputSchema } from "./schemas.js";
import { MailbridgeToolService, type AccessPreferencesProposal } from "./service.js";
import { ACCESS_PREFERENCES_UI_HTML } from "./access-preferences-ui.js";
import { ACCESS_PREFERENCES_FORM_OPTIONS, ACCESS_PREFERENCES_UI_URI, TOOL_DEFINITIONS, type ToolDefinition } from "./tool-definitions.js";
import { SERVER_INFO } from "./version.js";

export interface CreateMailbridgeServerOptions {
  readonly localPreferencesContext?: LocalPreferencesContext;
}

export { SERVER_INFO } from "./version.js";

const UI_EXTENSION = "io.modelcontextprotocol/ui";
const UI_MIME_TYPE = "text/html;profile=mcp-app";
// Human review needs longer than the SDK's 60-second network-request default.
// Keep a fixed deadline: a late response must never revive an expired send.
const HUMAN_REVIEW_TIMEOUT_MS = 5 * 60 * 1_000;
const REVIEW_DEADLINE_MESSAGE = "This review expires after 5 minutes.";

function preferencesConfirmationMessage(proposal: AccessPreferencesProposal): string {
  const quote = (value: unknown): string => JSON.stringify(value).replace(
    /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu,
    (character) => `\\u{${character.codePointAt(0)?.toString(16).padStart(4, "0")}}`,
  );
  const fields = [
    "Save these Mailbridge access preferences?",
    `Mode: ${proposal.proposedMode}`,
    `Accounts (complete replacement): ${quote(proposal.proposedAllowedAccounts)}`,
    "Read mail: yes",
    `Create drafts: ${proposal.proposedMode !== "read-only" ? "yes" : "no"}`,
    `Change read/flag state: ${["full", "prompted"].includes(proposal.proposedMode) ? "yes" : "no"}`,
    `Send mail: ${proposal.proposedMode === "prompted" ? "separate approval for every send" : "no"}`,
    "Applies after restarting or reconnecting Mailbridge.",
  ];
  if (proposal.shadowedByEnvironment.mode) fields.push("The launch mode overrides this saved mode until removed.");
  if (proposal.shadowedByEnvironment.allowedAccounts) fields.push("The launch account list overrides this saved list until removed.");
  if (!proposal.verification.performed) fields.push("These addresses could not be verified against Mail.app.");
  else if (proposal.verification.unmatchedAccounts.length > 0) {
    fields.push(`Not found in the running account scope: ${quote(proposal.verification.unmatchedAccounts)}`);
  }
  if (proposal.savedPreferencesDiagnostic) fields.push("Existing saved settings are unreadable and will be replaced.");
  fields.push("Continue saves exactly these settings. Skip cancels.");
  fields.push(REVIEW_DEADLINE_MESSAGE);
  return fields.join("  •  ");
}

export function createMailbridgeServer(
  bridge: MailBridge,
  config: MailbridgeConfig,
  options?: CreateMailbridgeServerOptions,
): McpServer {
  const server = new McpServer(SERVER_INFO, {
    capabilities: {
      tools: {},
      resources: {},
      extensions: { [UI_EXTENSION]: {} },
    },
  });
  const service = new MailbridgeToolService(
    bridge,
    config,
    async (confirmation) => {
      const result = await server.server.elicitInput({
        mode: "form",
        message: `${outboundPreviewMessage(confirmation)}\u2028\u2028${REVIEW_DEADLINE_MESSAGE}`,
        requestedSchema: { type: "object", properties: {} },
      }, { timeout: HUMAN_REVIEW_TIMEOUT_MS });
      return result.action === "accept";
    },
    options?.localPreferencesContext,
  );

  server.registerResource(
    "mailbridge-access-preferences",
    ACCESS_PREFERENCES_UI_URI,
    { mimeType: UI_MIME_TYPE },
    () => Promise.resolve({
      contents: [
        {
          uri: ACCESS_PREFERENCES_UI_URI,
          mimeType: UI_MIME_TYPE,
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

  const registerTool = (definition: ToolDefinition, supportsApps: boolean): void => {
    if (!definition.allowedModes.includes(config.mode)) return;
    if (definition.name === "mailbridge_commit_access_preferences" && !supportsApps) return;
    const nativePreferences = definition.name === "mailbridge_set_access_preferences" && !supportsApps;
    server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema,
        outputSchema: toolOutputSchema,
        annotations: definition.annotations,
        ...(definition._meta === undefined ? {} : { _meta: definition._meta }),
        ...(nativePreferences ? ACCESS_PREFERENCES_FORM_OPTIONS : {}),
      },
      async (input) => {
        if (!nativePreferences) return service.invoke(definition.name, input);
        const capabilities = server.server.getClientCapabilities();
        return service.invokeAccessPreferencesWithConfirmation(input, capabilities?.elicitation === undefined
          ? undefined
          : async (proposal) => {
            const result = await server.server.elicitInput({
              mode: "form",
              message: preferencesConfirmationMessage(proposal),
              requestedSchema: { type: "object", properties: {} },
            }, { timeout: HUMAN_REVIEW_TIMEOUT_MS });
            return result.action === "accept";
          });
      },
    );
  };

  // The SDK installs tools/list and advertises listChanged on first registration,
  // which must happen before connecting. Register the host-neutral account read
  // first, then select the preference interface after capability negotiation.
  const [firstTool, ...remainingTools] = TOOL_DEFINITIONS;
  if (firstTool !== undefined) registerTool(firstTool, false);
  server.server.oninitialized = () => {
    const ui = server.server.getClientCapabilities()?.extensions?.[UI_EXTENSION];
    const supportsApps = typeof ui === "object" && ui !== null && "mimeTypes" in ui &&
      Array.isArray(ui.mimeTypes) && ui.mimeTypes.includes(UI_MIME_TYPE);
    for (const definition of remainingTools) registerTool(definition, supportsApps);
  };

  return server;
}

export { MailbridgeToolService } from "./service.js";
export type { AccessPreferencesProposal, ConfirmMailSend, MailSendConfirmation } from "./service.js";
export { ACCESS_PREFERENCES_UI_URI, TOOL_DEFINITIONS } from "./tool-definitions.js";
