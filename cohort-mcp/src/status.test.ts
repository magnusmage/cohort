import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { git } from "./git.js";
import { loadPolicyFromText } from "./policy.js";
import { createRecord, serializeRecord } from "./record.js";
import { buildStatus } from "./status.js";

const source = { agent: "claude-code@alice", model: "claude-opus-4-8", commit: "a1b2c3d" };
const AGENT = "claude-code@alice";
const POLICY = loadPolicyFromText("defaults:\n  load: ask\n  propose: ask\n  on_write: pull_request\n");

async function writeRecord(root: string, path: string, kind: "fact" | "decision" | "thread", text: string, status?: string): Promise<void> {
  const record = createRecord({ kind, text, source });
  if (status) record.meta.status = status as typeof record.meta.status;
  const abs = join(root, path);
  await mkdir(join(abs, ".."), { recursive: true });
  await writeFile(abs, serializeRecord(record));
}

async function setupVault(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "cohort-status-"));
  const root = join(base, "work");
  await git(["init", root]);
  await git(["-C", root, "symbolic-ref", "HEAD", "refs/heads/main"]);
  await git(["-C", root, "config", "user.name", "Test"]);
  await git(["-C", root, "config", "user.email", "test@example.com"]);
  await writeRecord(root, "facts/a.md", "fact", "Fact one.");
  await writeRecord(root, "facts/b.md", "fact", "Fact two, promoted.", "verified");
  await writeRecord(root, "decisions/c.md", "decision", "A decision.");
  await mkdir(join(root, "facts"), { recursive: true });
  await writeFile(join(root, "facts", "bad.md"), "this is not a valid record");
  await git(["-C", root, "add", "-A"]);
  await git(["-C", root, "commit", "-m", "seed"]);
  return root;
}

test("status reports real counts by kind and status", async () => {
  const root = await setupVault();
  const view = await buildStatus(root, POLICY, AGENT);
  assert.equal(view.counts.byKind.fact, 2);
  assert.equal(view.counts.byKind.decision, 1);
  assert.equal(view.counts.byKind.thread, 0);
  assert.equal(view.counts.byStatus.quarantined, 2);
  assert.equal(view.counts.byStatus.verified, 1);
  assert.equal(view.counts.unreadable, 1, "the malformed file is counted, not guessed");
  assert.equal(view.quarantine.count, 2);
});

test("status reports policy and an untracked pending list", async () => {
  const root = await setupVault();
  const view = await buildStatus(root, POLICY, AGENT);
  assert.equal(view.agent, AGENT);
  assert.equal(view.degraded, false);
  assert.equal(view.effective.propose, "ask");
  assert.equal(view.pending.tracked, false);
  assert.deepEqual(view.pending.items, []);
});
