import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { git } from "./git.js";
import { type VaultRecord, createRecord, serializeRecord } from "./record.js";
import {
  listRemoved,
  loadRetentionFromText,
  pathForId,
  recoverRecord,
  withinRetention,
} from "./retention.js";

const source = { agent: "claude-code@alice", model: "claude-opus-4-8", commit: "a1b2c3d" };

function fact(text: string): VaultRecord {
  return createRecord({ kind: "fact", text, source });
}

async function vault(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "cohort-retention-"));
  const root = join(base, "work");
  await git(["init", root]);
  await git(["-C", root, "symbolic-ref", "HEAD", "refs/heads/main"]);
  await git(["-C", root, "config", "user.name", "T"]);
  await git(["-C", root, "config", "user.email", "t@e.com"]);
  return root;
}

async function commit(root: string, msg: string): Promise<void> {
  await git(["-C", root, "add", "-A"]);
  await git(["-C", root, "commit", "-m", msg]);
}

test("pathForId maps kind prefixes and rejects unknown ones", () => {
  assert.equal(pathForId("f-abc123abc123"), "facts/f-abc123abc123.md");
  assert.equal(pathForId("d-abc123abc123"), "decisions/d-abc123abc123.md");
  assert.equal(pathForId("t-abc123abc123"), "threads/t-abc123abc123.md");
  assert.equal(pathForId("x-abc123abc123"), null);
});

test("withinRetention honors the window", () => {
  const now = new Date("2026-10-20T00:00:00Z");
  assert.equal(withinRetention("2026-10-01T00:00:00Z", 365, now), true);
  assert.equal(withinRetention("2020-01-01T00:00:00Z", 365, now), false);
  assert.equal(withinRetention("not-a-date", 365, now), false);
});

test("loadRetentionFromText defaults keep_days and rejects bad input", () => {
  assert.equal(loadRetentionFromText("version: 1").keep_days, 365);
  assert.equal(loadRetentionFromText("keep_days: 30").keep_days, 30);
  assert.throws(() => loadRetentionFromText("keep_days: -5"), /invalid retention config/);
});

test("recoverRecord restores a removed record from history", async () => {
  const root = await vault();
  const rec = fact("Postgres is the primary store.");
  const path = `facts/${rec.meta.id}.md`;
  await mkdir(join(root, "facts"), { recursive: true });
  await writeFile(join(root, path), serializeRecord(rec));
  await commit(root, "add");

  // Remove it from the working tree and commit the deletion.
  await rm(join(root, path));
  await commit(root, "remove");

  const before = await recoverRecord(root, rec.meta.id);
  assert.equal(before.found, true);
  assert.equal(before.tracked, false);
  assert.ok(before.removedAt, "removal date is reported");
  assert.match(before.preview ?? "", /Postgres is the primary store/);

  const restored = await recoverRecord(root, rec.meta.id, { restore: true });
  assert.equal(restored.restored, true);
  await access(join(root, path)); // throws if not restored
});

test("recoverRecord reports a record that is still tracked", async () => {
  const root = await vault();
  const rec = fact("Still here.");
  await mkdir(join(root, "facts"), { recursive: true });
  await writeFile(join(root, `facts/${rec.meta.id}.md`), serializeRecord(rec));
  await commit(root, "add");
  const r = await recoverRecord(root, rec.meta.id);
  assert.equal(r.found, true);
  assert.equal(r.tracked, true);
  assert.match(r.note ?? "", /still tracked/);
});

test("recoverRecord returns not-found for an id with no history", async () => {
  const root = await vault();
  const r = await recoverRecord(root, "f-zzzzzzzzzzzz");
  assert.equal(r.found, false);
});

test("listRemoved finds removed records and flags the retention window", async () => {
  const root = await vault();
  const keep = fact("Kept fact.");
  const gone = fact("Removed fact.");
  await mkdir(join(root, "facts"), { recursive: true });
  await writeFile(join(root, `facts/${keep.meta.id}.md`), serializeRecord(keep));
  await writeFile(join(root, `facts/${gone.meta.id}.md`), serializeRecord(gone));
  await commit(root, "add two");
  await rm(join(root, `facts/${gone.meta.id}.md`));
  await commit(root, "remove one");

  const removed = await listRemoved(root, { keep_days: 365 });
  assert.equal(removed.length, 1);
  assert.equal(removed[0]?.id, gone.meta.id);
  assert.equal(removed[0]?.withinRetention, true);

  const tight = await listRemoved(root, { keep_days: 0 });
  assert.equal(tight[0]?.withinRetention, false, "a zero-day window puts the removal beyond retention");
});
