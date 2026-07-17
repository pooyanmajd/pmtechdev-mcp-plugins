import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { ConfigError, loadConfig } from "./config.js";
import { toPublicError } from "./errors.js";
import { createMailBridge } from "./mail/bridge.js";
import { createMailbridgeServer } from "./server/index.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const bridge = createMailBridge({
    ...(config.allowedAccounts === undefined ? {} : { allowedAccounts: [...config.allowedAccounts] }),
    promptedSend: config.mode === "prompted",
    maxBodyChars: config.maxBodyChars,
    maxResults: config.maxResults,
    timeoutMs: config.timeoutMs,
    searchBudgetMs: config.searchBudgetMs,
  });
  const server = createMailbridgeServer(bridge, config);
  await server.connect(new StdioServerTransport());
}

void main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    process.stderr.write(`Mailbridge failed to start: [${error.code}] ${error.message}\n`);
  } else {
    const publicError = toPublicError(error);
    process.stderr.write(`Mailbridge failed to start: [${publicError.code}] ${publicError.message}\n`);
  }
  process.exitCode = 1;
});
