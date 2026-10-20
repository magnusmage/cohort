import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { git } from "./git.js";
import { loadPolicyFromText } from "./policy.js";
import { createRecord, serializeRecord } from "./record.js";
import { searchVault } from "./search.js";

const source = { agent: "claude-code@alice", model: "claude-opus-4-8", commit: "a1b2c3d" };
const AGENT = "claude-code@bob";
const POLICY = loadPolicyFromText(`
defaults: { load: ask, propose: ask, on_write: pull_request }
paths:
  readable: ["facts/**", "decisions/**"]
  writable: ["facts/**"]
  deny: []
`);

async function vaultWith(
  records: Array<{ path: string; kind: "fact" | "decision" | "thread"; text: string; status?: string; verifiedBy?: string }>,
): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "cohort-search-"));
  const root = join(base, "work");
  await git(["init", root]);
  await git(["-C", root, "symbolic-ref", "HEAD", "refs/heads/main"]);
  await git(["-C", root, "config", "user.name", "T"]);
  await git(["-C", root, "config", "user.email", "t@e.com"]);
  for (const r of records) {
    const rec = createRecord({ kind: r.kind, text: r.text, source });
    if (r.status) rec.meta.status = r.status as typeof rec.meta.status;
    if (r.verifiedBy) rec.meta.verified_by = r.verifiedBy;
    const abs = join(root, r.path);
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, serializeRecord(rec));
  }
  await git(["-C", root, "add", "-A"]);
  await git(["-C", root, "commit", "-m", "seed"]);
  return root;
}

const RECORDS: Array<{ path: string; kind: "fact" | "decision" | "thread"; text: string; status?: string; verifiedBy?: string }> = [
  { path: "facts/v.md", kind: "fact", text: "Postgres is the primary store.", status: "verified", verifiedBy: "alice" },
  { path: "facts/q.md", kind: "fact", text: "Postgres connection pooling note.", status: "quarantined" },
  { path: "facts/old.md", kind: "fact", text: "Old Postgres note.", status: "superseded" },
  { path: "decisions/d.md", kind: "decision", text: "Use structured logging.", status: "verified", verifiedBy: "alice" },
  { path: "threads/t.md", kind: "thread", text: "Postgres thread outside readable scope.", status: "verified", verifiedBy: "alice" },
];

test("default search returns verified matches only, honoring readable scope", async () => {
  const root = await vaultWith(RECORDS);
  const result = await searchVault(root, POLICY, AGENT, { query: "postgres" });
  const snippets = result.hits.map((h) => h.snippet);
  assert.ok(snippets.includes("Postgres is the primary store."), "verified fact matched");
  assert.ok(!snippets.some((s) => s.includes("connection pooling")), "quarantined excluded by default");
  assert.ok(!snippets.some((s) => s.includes("Old Postgres")), "superseded excluded");
  assert.ok(!snippets.some((s) => s.includes("outside readable")), "threads path not readable");
  assert.ok(result.hits.every((h) => h.status === "verified"));
});

test("include_quarantined widens the search", async () => {
  const root = await vaultWith(RECORDS);
  const result = await searchVault(root, POLICY, AGENT, { query: "postgres", includeQuarantined: true });
  const snippets = result.hits.map((h) => h.snippet);
  assert.ok(snippets.includes("Postgres is the primary store."));
  assert.ok(snippets.some((s) => s.includes("connection pooling")), "quarantined now included");
  assert.ok(!snippets.some((s) => s.includes("Old Postgres")), "superseded still excluded");
});

test("a non-matching query returns nothing", async () => {
  const root = await vaultWith(RECORDS);
  const result = await searchVault(root, POLICY, AGENT, { query: "kubernetes", includeQuarantined: true });
  assert.equal(result.count, 0);
  assert.deepEqual(result.hits, []);
});
