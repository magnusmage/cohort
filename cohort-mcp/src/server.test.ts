import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import type { EffectivePolicyView } from "./policy.js";
import { PHASE1_TOOLS, type ServerOptions, createServer } from "./server.js";

const STUB_TOOLS = ["cohort_load", "cohort_propose", "cohort_status"] as const;

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

const VALID_ARGS: Record<(typeof STUB_TOOLS)[number], Record<string, unknown>> = {
  cohort_load: {},
  cohort_propose: { items: [{ kind: "fact", text: "scaffold smoke test" }] },
  cohort_status: {},
};

test("registers exactly the four Phase 1 tools", async () => {
  const client = await connectClient();
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [...PHASE1_TOOLS].sort());
});

test("the three unimplemented tools report explicit stubs", async () => {
  const client = await connectClient();
  for (const name of STUB_TOOLS) {
    const result = await client.callTool({ name, arguments: VALID_ARGS[name] });
    assert.equal(result.isError, true, `${name} should be an error stub`);
    const content = result.content as Array<{ type: string; text?: string }>;
    assert.match(content[0]?.text ?? "", /not implemented/i, `${name} should say not implemented`);
  }
});

test("cohort_policy_get returns the read-only view from the provider", async () => {
  const client = await connectClient({ policyProvider: async () => SAMPLE_VIEW });
  const result = await client.callTool({ name: "cohort_policy_get", arguments: {} });
  assert.notEqual(result.isError, true, "policy_get must not be an error");
  const content = result.content as Array<{ type: string; text?: string }>;
  const view = JSON.parse(content[0]?.text ?? "{}") as EffectivePolicyView;
  assert.deepEqual(view, SAMPLE_VIEW);
});

test("there is no tool that writes policy", async () => {
  const client = await connectClient();
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  for (const n of names) {
    assert.doesNotMatch(n, /policy_set|policy_write|set_policy|write_policy/i, `${n} must not be a policy writer`);
  }
});
