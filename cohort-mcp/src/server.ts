import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  TOOL_NOT_IMPLEMENTED,
  loadInput,
  policyGetInput,
  proposeInput,
  statusInput,
} from "./tools.js";

export const SERVER_NAME = "cohort-mcp";
export const SERVER_VERSION = "0.1.0";

/** The four Phase 1 tools, in the order the contract lists them. */
export const PHASE1_TOOLS = [
  "cohort_load",
  "cohort_propose",
  "cohort_status",
  "cohort_policy_get",
] as const;

function notImplemented(tool: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: `${tool} ${TOOL_NOT_IMPLEMENTED}` }],
  };
}

/**
 * Build the Cohort MCP server with the four Phase 1 tools registered as stubs.
 *
 * Exported (rather than only started) so tests can connect an in-memory client
 * and assert the tool list and the handshake without a real client.
 */
export function createServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "cohort_load",
    {
      title: "Load team context",
      description:
        "Return bounded team context from the vault, fenced as data not instructions. Stub in the scaffold.",
      inputSchema: loadInput,
    },
    async () => notImplemented("cohort_load"),
  );

  server.registerTool(
    "cohort_propose",
    {
      title: "Propose a writeback",
      description:
        "Run proposed records through the server-enforced write gate. Stub in the scaffold.",
      inputSchema: proposeInput,
    },
    async () => notImplemented("cohort_propose"),
  );

  server.registerTool(
    "cohort_status",
    {
      title: "Vault and policy status",
      description: "Report the effective policy summary and pending state. Stub in the scaffold.",
      inputSchema: statusInput,
    },
    async () => notImplemented("cohort_status"),
  );

  server.registerTool(
    "cohort_policy_get",
    {
      title: "Read effective policy",
      description:
        "Return the caller's effective, read-only policy limits. Stub in the scaffold.",
      inputSchema: policyGetInput,
    },
    async () => notImplemented("cohort_policy_get"),
  );

  return server;
}
