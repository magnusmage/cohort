import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { git } from "./git.js";
import {
  INDEX_PATH,
  INDEX_VERSION,
  buildIndex,
  estimateTokens,
  indexStatus,
  parseIndex,
  readIndex,
  serializeIndex,
  writeIndex,
} from "./indexer.js";
import { createRecord, serializeRecord, type VaultRecord } from "./record.js";

const source = { agent: "claude-code@alice", model: "claude-opus-4-8", commit: "a1b2c3d" };

function recordFor(kind: "fact" | "decision" | "thread", text: string, status?: string, verifiedBy?: string): VaultRecord {
  const rec = createRecord({ kind, text, source });
  if (status) rec.meta.status = status as typeof rec.meta.status;
  if (verifiedBy) rec.meta.verified_by = verifiedBy;
  return rec;
}

async function vaultWith(records: Array<{ dir: string; name: string; record: VaultRecord }>): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "cohort-indexer-"));
  const root = join(base, "work");
  await git(["init", root]);
  await git(["-C", root, "symbolic-ref", "HEAD", "refs/heads/main"]);
  await git(["-C", root, "config", "user.name", "T"]);
  await git(["-C", root, "config", "user.email", "t@e.com"]);
  for (const r of records) {
    await mkdir(join(root, r.dir), { recursive: true });
    await writeFile(join(root, r.dir, r.name), serializeRecord(r.record));
  }
  await git(["-C", root, "add", "-A"]);
  await git(["-C", root, "commit", "-m", "seed"]);
  return root;
}

const SEED = [
  { dir: "facts", name: "a.md", record: recordFor("fact", "Fact A, verified.", "verified", "alice") },
  { dir: "decisions", name: "b.md", record: recordFor("decision", "Decision B, quarantined.") },
  { dir: "threads", name: "c.md", record: recordFor("thread", "Thread C.") },
];

test("estimateTokens is deterministic and length-based", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("abcde"), 2);
});

test("buildIndex captures every record, sorted by id", async () => {
  const root = await vaultWith(SEED);
  const index = await buildIndex(root);
  assert.equal(index.version, INDEX_VERSION);
  assert.equal(index.records.length, 3);
  const ids = index.records.map((r) => r.id);
  assert.deepEqual(ids, [...ids].sort());
  const verified = index.records.find((r) => r.status === "verified");
  assert.ok(verified);
  assert.equal(verified?.verified_by, "alice");
  assert.ok(verified && verified.contentHash.length === 64);
  assert.ok(verified && verified.approxTokens > 0);
});

test("a rebuild on the same vault is byte-identical", async () => {
  const root = await vaultWith(SEED);
  const a = serializeIndex(await buildIndex(root));
  const b = serializeIndex(await buildIndex(root));
  assert.equal(a, b);
});

test("the index holds no record body", async () => {
  const root = await vaultWith(SEED);
  const json = serializeIndex(await buildIndex(root));
  assert.doesNotMatch(json, /Fact A, verified/);
  assert.doesNotMatch(json, /Decision B/);
});

test("write then read round-trips at the committed path", async () => {
  const root = await vaultWith(SEED);
  const built = await buildIndex(root);
  const path = await writeIndex(root, built);
  assert.equal(path, INDEX_PATH);
  const read = await readIndex(root);
  assert.deepStrictEqual(read, built);
});

test("readIndex returns null when the index is absent", async () => {
  const root = await vaultWith(SEED);
  assert.equal(await readIndex(root), null);
});

test("parseIndex rejects an unsupported version", () => {
  assert.throws(() => parseIndex('{"version":"9","records":[]}'), /unsupported index version/);
  assert.throws(() => parseIndex('{"version":"1","records":{}}'), /records must be an array/);
});

test("indexStatus reports in sync once the fresh index is committed", async () => {
  const root = await vaultWith(SEED);
  await writeIndex(root, await buildIndex(root));
  const status = await indexStatus(root);
  assert.equal(status.committed, true);
  assert.equal(status.inSync, true);
  assert.deepEqual([status.missing, status.stale, status.changed], [[], [], []]);
});

test("indexStatus flags a missing index as out of sync", async () => {
  const root = await vaultWith(SEED);
  const status = await indexStatus(root);
  assert.equal(status.committed, false);
  assert.equal(status.inSync, false);
  assert.equal(status.missing.length, 3);
});

test("indexStatus detects added, changed, and removed records", async () => {
  const root = await vaultWith(SEED);
  await writeIndex(root, await buildIndex(root));
  await git(["-C", root, "add", "-A"]);
  await git(["-C", root, "commit", "-m", "index"]);

  // Add a record, edit one in place, remove another.
  const added = recordFor("fact", "Fact D, new.");
  await writeFile(join(root, "facts", "d.md"), serializeRecord(added));
  const editedId = (await buildIndex(root)).records.find((r) => r.path === "threads/c.md")?.id;
  const edited = recordFor("thread", "Thread C.");
  edited.meta.status = "verified";
  edited.meta.verified_by = "bob";
  await writeFile(join(root, "threads", "c.md"), serializeRecord(edited));
  await rm(join(root, "decisions", "b.md"));
  await git(["-C", root, "add", "-A"]);
  await git(["-C", root, "commit", "-m", "mutate"]);

  const status = await indexStatus(root);
  assert.equal(status.inSync, false);
  assert.equal(status.missing.length, 1, "the new fact is missing from the committed index");
  assert.equal(status.stale.length, 1, "the removed decision is stale in the committed index");
  assert.ok(editedId && status.changed.includes(editedId), "the edited thread is flagged as changed");
});
