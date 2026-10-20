import process from "node:process";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { type LoadResult, defaultLoadContext } from "./load.js";
import { type EffectivePolicyView, defaultPolicyView } from "./policy.js";
import { type ProposeItem, type ProposeItemResult, defaultPropose } from "./propose.js";
import { type StatusView, defaultStatus } from "./status.js";
import { loadInput, policyGetInput, proposeInput, statusInput } from "./tools.js";

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

/** Returns a bounded, fenced slice of the vault. */
export type ContextProvider = (args: { topics?: string[]; scope?: string }) => Promise<LoadResult>;

/** Runs proposed items through the write gate and returns a per-item decision. */
export type ProposeRunner = (items: ProposeItem[]) => Promise<ProposeItemResult[]>;

/** Returns a read-only snapshot of the vault and policy state. */
export type StatusProvider = () => Promise<StatusView>;

export interface ServerOptions {
  /** Supplies the read-only policy view for cohort_policy_get. Injectable for tests. */
  policyProvider?: PolicyProvider;
  /** Supplies the fenced context for cohort_load. Injectable for tests. */
  contextProvider?: ContextProvider;
  /** Runs proposals through the gate for cohort_propose. Injectable for tests. */
  proposeRunner?: ProposeRunner;
  /** Supplies the status snapshot for cohort_status. Injectable for tests. */
  statusProvider?: StatusProvider;
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

/**
 * Build the Cohort MCP server with the four Phase 1 tools implemented.
 *
 * Every tool is read-only except cohort_propose, which only ever goes through
 * the server-enforced write gate. There is no tool that writes policy.yml and
 * none that approves a pending proposal; approval is out of band.
 */
export function createServer(options: ServerOptions = {}): McpServer {
  const policyProvider: PolicyProvider =
    options.policyProvider ?? (() => defaultPolicyView(process.env, process.cwd()));
  const contextProvider: ContextProvider =
    options.contextProvider ?? ((args) => defaultLoadContext(process.env, process.cwd(), args));
  const proposeRunner: ProposeRunner =
    options.proposeRunner ?? ((items) => defaultPropose(process.env, process.cwd(), items));
  const statusProvider: StatusProvider =
    options.statusProvider ?? (() => defaultStatus(process.env, process.cwd()));

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "cohort_load",
    {
      title: "Load team context",
      description:
        "Return bounded team context from the vault, fenced as data not instructions.",
      inputSchema: loadInput,
    },
    async ({ topics, scope }) => {
      const result = await contextProvider({ topics, scope });
      return textResult(result.text);
    },
  );

  server.registerTool(
    "cohort_propose",
    {
      title: "Propose a writeback",
      description: "Run proposed records through the server-enforced write gate.",
      inputSchema: proposeInput,
    },
    async ({ items }) => {
      const results = await proposeRunner(items as ProposeItem[]);
      return textResult(JSON.stringify(results, null, 2));
    },
  );

  server.registerTool(
    "cohort_status",
    {
      title: "Vault and policy status",
      description: "Report the effective policy summary and record counts from the vault.",
      inputSchema: statusInput,
    },
    async () => {
      const view = await statusProvider();
      return textResult(JSON.stringify(view, null, 2));
    },
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
