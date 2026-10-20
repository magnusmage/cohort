import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { git } from "./git.js";
import { createRecord, serializeRecord } from "./record.js";
import { explainRecord } from "./why.js";

const source = { agent: "claude-code@alice", model: "claude-opus-4-8", commit: "a1b2c3d" };

async function setupVault(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "cohort-why-"));
  const root = join(base, "work");
  await git(["init", root]);
  await git(["-C", root, "symbolic-ref", "HEAD", "refs/heads/main"]);
  await git(["-C", root, "config", "user.name", "Alice Reviewer"]);
  await git(["-C", root, "config", "user.email", "alice@example.com"]);
  return root;
}

test("explainRecord returns claimed provenance and git history", async () => {
  const root = await setupVault();
  const rec = createRecord({ kind: "fact", text: "Postgres is the primary store.", source });
  await mkdir(join(root, "facts"), { recursive: true });
  const path = `facts/${rec.meta.id}.md`;
  await writeFile(join(root, path), serializeRecord(rec));
  await git(["-C", root, "add", "-A"]);
  await git(["-C", root, "commit", "-m", "memory: add fact"]);

  const why = await explainRecord(root, rec.meta.id);
  assert.equal(why.found, true);
  assert.equal(why.path, path);
  assert.equal(why.kind, "fact");
  assert.equal(why.claimed?.agent, "claude-code@alice");
  assert.equal(why.claimed?.model, "claude-opus-4-8");
  assert.equal(why.history?.commitCount, 1);
  assert.equal(why.history?.firstSeen?.author, "Alice Reviewer");
  assert.equal(why.history?.firstSeen?.subject, "memory: add fact");
  assert.match(why.preview ?? "", /Postgres is the primary store/);
});

test("explainRecord tracks the first and last change across commits", async () => {
  const root = await setupVault();
  const rec = createRecord({ kind: "fact", text: "Deploys need two approvals.", source });
  await mkdir(join(root, "facts"), { recursive: true });
  const path = `facts/${rec.meta.id}.md`;
  await writeFile(join(root, path), serializeRecord(rec));
  await git(["-C", root, "add", "-A"]);
  await git(["-C", root, "commit", "-m", "add"]);

  // A later human change: verify in place.
  rec.meta.status = "verified";
  rec.meta.verified_by = "alice";
  await writeFile(join(root, path), serializeRecord(rec));
  await git(["-C", root, "add", "-A"]);
  await git(["-C", root, "commit", "-m", "verify"]);

  const why = await explainRecord(root, rec.meta.id);
  assert.equal(why.history?.commitCount, 2);
  assert.equal(why.history?.firstSeen?.subject, "add");
  assert.equal(why.history?.lastChanged?.subject, "verify");
});

test("explainRecord reports a missing record", async () => {
  const root = await setupVault();
  const why = await explainRecord(root, "f-zzzzzzzzzzzz");
  assert.equal(why.found, false);
  assert.match(why.note ?? "", /no record/);
});
