import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { git } from "./git.js";
import { loadPolicyFromText } from "./policy.js";
import { createRecord, serializeRecord } from "./record.js";
import { computeStats } from "./stats.js";

const source = { agent: "claude-code@alice", model: "claude-opus-4-8", commit: "a1b2c3d" };
const POLICY = loadPolicyFromText(`
defaults: { load: ask, propose: ask, on_write: pull_request }
paths:
  readable: ["facts/**", "decisions/**"]
  writable: ["facts/**"]
  deny: []
`);

async function write(root: string, path: string, kind: "fact" | "decision" | "thread", text: string, status?: string): Promise<void> {
  const rec = createRecord({ kind, text, source });
  if (status) rec.meta.status = status as typeof rec.meta.status;
  const abs = join(root, path);
  await mkdir(join(abs, ".."), { recursive: true });
  await writeFile(abs, serializeRecord(rec));
}

async function setupVault(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "cohort-stats-"));
  const root = join(base, "work");
  await git(["init", root]);
  await git(["-C", root, "symbolic-ref", "HEAD", "refs/heads/main"]);
  await git(["-C", root, "config", "user.name", "Writer"]);
  await git(["-C", root, "config", "user.email", "w@e.com"]);
  await write(root, "facts/a.md", "fact", "Postgres is the store.", "verified");
  await write(root, "facts/b.md", "fact", "A quarantined fact.");
  await write(root, "decisions/c.md", "decision", "Use structured logging.");
  await git(["-C", root, "add", "-A"]);
  await git(["-C", root, "commit", "-m", "memory: add records"]);
  return root;
}

test("stats reports vault-derived figures and marks the rest not tracked", async () => {
  const root = await setupVault();
  const s = await computeStats(root, POLICY, "claude-code@bob");
  assert.equal(s.records.total, 3);
  assert.equal(s.records.byKind.fact, 2);
  assert.equal(s.records.byKind.decision, 1);
  assert.equal(s.records.byStatus.verified, 1);
  assert.equal(s.records.byStatus.quarantined, 2);
  assert.ok(s.writebacks.recordCommits >= 1, "at least one writeback commit");
  assert.equal(s.writebacks.contributors, 1);
  assert.ok(s.currentLoad.approxTokens > 0, "a current load size estimate");
  assert.ok(s.notTracked.length > 0, "telemetry-dependent figures are listed as not tracked");
  assert.match(s.note, /no telemetry/i);
});
