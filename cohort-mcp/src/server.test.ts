import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { PHASE1_TOOLS, createServer } from "./server.js";

/** Connect a client to the server over an in-memory transport pair. */
async function connectClient(): Promise<Client> {
  const server = createServer();
  const client = new Client({ name: "cohort-mcp-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

test("registers exactly the four Phase 1 tools", async () => {
  const client = await connectClient();
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [...PHASE1_TOOLS].sort());
});

// Minimal valid arguments per tool, so the call passes schema validation and
// reaches the stub handler (cohort_propose requires a non-empty items array).
const VALID_ARGS: Record<(typeof PHASE1_TOOLS)[number], Record<string, unknown>> = {
  cohort_load: {},
  cohort_propose: { items: [{ kind: "fact", text: "scaffold smoke test" }] },
  cohort_status: {},
  cohort_policy_get: {},
};

test("each tool reports an explicit not-implemented stub", async () => {
  const client = await connectClient();
  for (const name of PHASE1_TOOLS) {
    const result = await client.callTool({ name, arguments: VALID_ARGS[name] });
    assert.equal(result.isError, true, `${name} should be an error stub`);
    const content = result.content as Array<{ type: string; text?: string }>;
    assert.match(content[0]?.text ?? "", /not implemented/i, `${name} should say not implemented`);
  }
});
