import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import type { LoadResult } from "./load.js";
import type { EffectivePolicyView } from "./policy.js";
import type { ProposeItemResult } from "./propose.js";
import { PHASE1_TOOLS, type ServerOptions, createServer } from "./server.js";
import type { StatusView } from "./status.js";

const SAMPLE_VIEW: EffectivePolicyView = {
  agent: "claude-code@alice",
  degraded: false,
  defaults: { load: "ask", propose: "ask", on_write: "pull_request" },
  effective: { load: "auto", propose: "ask", on_write: "pull_request" },
  classes: ["coding-convention", "secret-or-credential"],
  paths: { readable: ["facts/**"], writable: ["facts/**"], deny: ["**/.env"] },
};

/** Connect a client to the server over an in-memory transport pair. */
async function connectClient(options: ServerOptions = {}): Promise<Client> {
  const server = createServer(options);
  const client = new Client({ name: "cohort-mcp-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

const SAMPLE_PROPOSE: ProposeItemResult[] = [
  { index: 0, kind: "fact", id: "f-000000000000", decision: "pending", handle: "abcd", reason: "held for human approval" },
];

const SAMPLE_STATUS: StatusView = {
  agent: "claude-code@alice",
  degraded: false,
  defaults: { load: "ask", propose: "ask", on_write: "pull_request" },
  effective: { load: "auto", propose: "ask", on_write: "pull_request" },
  counts: {
    byKind: { fact: 2, decision: 1, thread: 0 },
    byStatus: { proposed: 0, quarantined: 3, verified: 0, superseded: 0 },
    unreadable: 0,
  },
  pending: { tracked: false, items: [] },
  quarantine: { count: 3, note: "promotion via cohort_verify arrives in Phase 2" },
};

const SAMPLE_LOAD: LoadResult = {
  text: "**Shared team context from the Cohort vault** (last synced 00:00).\n(fenced)",
  included: 1,
  withheld: 0,
  loadMode: "ask",
};

test("registers exactly the four Phase 1 tools", async () => {
  const client = await connectClient();
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [...PHASE1_TOOLS].sort());
});

test("cohort_status returns the snapshot from the provider", async () => {
  const client = await connectClient({ statusProvider: async () => SAMPLE_STATUS });
  const result = await client.callTool({ name: "cohort_status", arguments: {} });
  assert.notEqual(result.isError, true, "cohort_status must not be an error");
  const content = result.content as Array<{ type: string; text?: string }>;
  const view = JSON.parse(content[0]?.text ?? "{}") as StatusView;
  assert.deepEqual(view, SAMPLE_STATUS);
});

test("cohort_propose returns per-item gate decisions from the runner", async () => {
  const client = await connectClient({ proposeRunner: async () => SAMPLE_PROPOSE });
  const result = await client.callTool({
    name: "cohort_propose",
    arguments: { items: [{ kind: "fact", text: "a proposed fact" }] },
  });
  assert.notEqual(result.isError, true, "cohort_propose must not be a protocol error");
  const content = result.content as Array<{ type: string; text?: string }>;
  const parsed = JSON.parse(content[0]?.text ?? "[]") as ProposeItemResult[];
  assert.deepEqual(parsed, SAMPLE_PROPOSE);
});

test("cohort_policy_get returns the read-only view from the provider", async () => {
  const client = await connectClient({ policyProvider: async () => SAMPLE_VIEW });
  const result = await client.callTool({ name: "cohort_policy_get", arguments: {} });
  assert.notEqual(result.isError, true, "policy_get must not be an error");
  const content = result.content as Array<{ type: string; text?: string }>;
  const view = JSON.parse(content[0]?.text ?? "{}") as EffectivePolicyView;
  assert.deepEqual(view, SAMPLE_VIEW);
});

test("cohort_load returns the fenced context from the provider", async () => {
  const client = await connectClient({ contextProvider: async () => SAMPLE_LOAD });
  const result = await client.callTool({ name: "cohort_load", arguments: {} });
  assert.notEqual(result.isError, true, "cohort_load must not be an error");
  const content = result.content as Array<{ type: string; text?: string }>;
  assert.equal(content[0]?.text, SAMPLE_LOAD.text);
});

test("there is no tool that writes policy", async () => {
  const client = await connectClient();
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  for (const n of names) {
    assert.doesNotMatch(n, /policy_set|policy_write|set_policy|write_policy/i, `${n} must not be a policy writer`);
    assert.doesNotMatch(n, /approve|verify/i, `${n} must not be a model-callable approval path in Phase 1`);
  }
});
