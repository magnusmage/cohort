import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { git } from "./git.js";
import { buildStatus } from "./status.js";
import { loadContext } from "./load.js";
import { loadPolicy, loadPolicyFromText } from "./policy.js";
import { type VaultRecord, createRecord, serializeRecord } from "./record.js";
import { isStale, supersededByVerified, todayStr } from "./staleness.js";
import { supersedeRecord } from "./supersede.js";

const source = { agent: "claude-code@alice", model: "claude-opus-4-8", commit: "a1b2c3d" };
const AGENT = "claude-code@bob";
const POLICY = loadPolicyFromText(`
defaults: { load: ask, propose: ask, on_write: pull_request }
paths:
  readable: ["facts/**", "decisions/**"]
  writable: ["facts/**"]
  deny: []
`);

function verified(text: string, extra: Partial<VaultRecord["meta"]> = {}): VaultRecord {
  const rec = createRecord({ kind: "fact", text, source });
  rec.meta.status = "verified";
  rec.meta.verified_by = "alice";
  Object.assign(rec.meta, extra);
  return rec;
}

async function vaultWith(records: Array<{ path: string; record: VaultRecord }>): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "cohort-stale-"));
  const root = join(base, "work");
  await git(["init", root]);
  await git(["-C", root, "symbolic-ref", "HEAD", "refs/heads/main"]);
  await git(["-C", root, "config", "user.name", "T"]);
  await git(["-C", root, "config", "user.email", "t@e.com"]);
  for (const r of records) {
    const abs = join(root, r.path);
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, serializeRecord(r.record));
  }
  await git(["-C", root, "add", "-A"]);
  await git(["-C", root, "commit", "-m", "seed"]);
  return root;
}

test("isStale is true only past a review_by horizon", () => {
  assert.equal(isStale({ review_by: null }), false);
  assert.equal(isStale({ review_by: "2000-01-01" }, "2026-10-20"), true);
  assert.equal(isStale({ review_by: "2999-01-01" }, "2026-10-20"), false);
  assert.equal(isStale({ review_by: todayStr() }), false, "due today is not yet overdue");
});

test("supersededByVerified honors only verified records", () => {
  const v = verified("New.", { supersedes: "f-aaaaaaaaaaaa" });
  const q = createRecord({ kind: "fact", text: "Quar.", source });
  q.meta.supersedes = "f-bbbbbbbbbbbb";
  const set = supersededByVerified([v, q]);
  assert.ok(set.has("f-aaaaaaaaaaaa"));
  assert.ok(!set.has("f-bbbbbbbbbbbb"), "a quarantined record cannot supersede");
});

test("a verified supersedes claim drops the old record from load but it stays in git", async () => {
  const oldRec = verified("Postgres is the primary store.");
  const newRec = verified("Postgres 16 is the primary store.", { supersedes: oldRec.meta.id });
  const root = await vaultWith([
    { path: "facts/old.md", record: oldRec },
    { path: "facts/new.md", record: newRec },
  ]);
  const result = await loadContext(root, POLICY, AGENT);
  assert.doesNotMatch(result.text, /Postgres is the primary store\./);
  assert.match(result.text, /Postgres 16 is the primary store/);
  // Still tracked in git.
  const tracked = await git(["-C", root, "ls-files", "facts/old.md"]);
  assert.equal(tracked.trim(), "facts/old.md");
});

test("a quarantined supersedes claim cannot hide a verified record", async () => {
  const target = verified("Deploys require two approvals.");
  const attacker = createRecord({ kind: "fact", text: "Deploys require no approvals.", source });
  attacker.meta.supersedes = target.meta.id; // quarantined, so must be ignored
  const root = await vaultWith([
    { path: "facts/t.md", record: target },
    { path: "facts/a.md", record: attacker },
  ]);
  const result = await loadContext(root, POLICY, AGENT);
  assert.match(result.text, /Deploys require two approvals\./, "the verified record must survive");
});

test("stale records are labeled, decayed below fresh, and surfaced in status", async () => {
  const fresh = verified("Fresh verified fact.");
  const stale = verified("Stale verified fact.", { review_by: "2000-01-01" });
  const root = await vaultWith([
    { path: "facts/fresh.md", record: fresh },
    { path: "facts/stale.md", record: stale },
  ]);
  const result = await loadContext(root, POLICY, AGENT);
  assert.match(result.text, /stale \(review overdue\)/);
  assert.match(result.text, /1 stale, review overdue/);
  assert.ok(
    result.text.indexOf("Fresh verified fact.") < result.text.indexOf("Stale verified fact."),
    "fresh ranks ahead of stale in the same tier",
  );
  const status = await buildStatus(root, await loadPolicy(root), AGENT);
  assert.equal(status.stale.count, 1);
  assert.equal(status.stale.items[0]?.review_by, "2000-01-01");
});

test("supersedeRecord marks the old record and links the new one", async () => {
  const oldRec = verified("Old claim.");
  const newRec = verified("New claim.");
  const root = await vaultWith([
    { path: "facts/old.md", record: oldRec },
    { path: "facts/new.md", record: newRec },
  ]);
  const r = await supersedeRecord(root, oldRec.meta.id, newRec.meta.id);
  assert.equal(r.status, "superseded");
  const { parseRecord } = await import("./record.js");
  const { readVaultFile } = await import("./git.js");
  assert.equal(parseRecord(await readVaultFile(root, "facts/old.md")).meta.status, "superseded");
  assert.equal(parseRecord(await readVaultFile(root, "facts/new.md")).meta.supersedes, oldRec.meta.id);
  // After superseding, the old record is gone from load and the new one remains.
  const result = await loadContext(root, POLICY, AGENT);
  assert.doesNotMatch(result.text, /Old claim\./);
  assert.match(result.text, /New claim\./);
});

test("supersedeRecord refuses self-supersede and missing records", async () => {
  const rec = verified("Only one.");
  const root = await vaultWith([{ path: "facts/a.md", record: rec }]);
  assert.equal((await supersedeRecord(root, rec.meta.id, rec.meta.id)).status, "error");
  assert.equal((await supersedeRecord(root, rec.meta.id, "f-zzzzzzzzzzzz")).status, "not-found");
});
