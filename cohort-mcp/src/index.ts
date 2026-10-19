#!/usr/bin/env node
import process from "node:process";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createServer } from "./server.js";

/**
 * Entry point. Starts the Cohort MCP server over stdio and shuts down cleanly
 * on a signal. The server runs until the client closes the stream.
 */
async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();

  let closing = false;
  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    try {
      await server.close();
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  await server.connect(transport);
}

main().catch((err: unknown) => {
  // Surface a startup failure. Never print secrets or tokens here.
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`cohort-mcp: fatal: ${message}\n`);
  process.exit(1);
});
