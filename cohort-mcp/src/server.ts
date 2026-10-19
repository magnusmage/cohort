import process from "node:process";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { type EffectivePolicyView, defaultPolicyView } from "./policy.js";
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

/** Returns the caller's effective, read-only policy view. */
export type PolicyProvider = () => Promise<EffectivePolicyView>;

export interface ServerOptions {
  /** Supplies the read-only policy view for cohort_policy_get. Injectable for tests. */
  policyProvider?: PolicyProvider;
}

function notImplemented(tool: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: `${tool} ${TOOL_NOT_IMPLEMENTED}` }],
  };
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

/**
 * Build the Cohort MCP server.
 *
 * cohort_policy_get is implemented and read-only: it returns the effective
 * policy for the server-established agent identity and exposes no path to
 * write policy.yml. The other three tools are stubs until their tickets.
 */
export function createServer(options: ServerOptions = {}): McpServer {
  const policyProvider: PolicyProvider =
    options.policyProvider ?? (() => defaultPolicyView(process.env, process.cwd()));

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
        "Return the caller's effective, read-only policy limits. The model cannot write policy.yml.",
      inputSchema: policyGetInput,
    },
    async () => {
      const view = await policyProvider();
      return textResult(JSON.stringify(view, null, 2));
    },
  );

  return server;
}
