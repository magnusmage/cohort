import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { git } from "./git.js";
import { loadContext } from "./load.js";
import { loadPolicyFromText } from "./policy.js";
import { createRecord, parseRecord, serializeRecord } from "./record.js";
import { readVaultFile } from "./git.js";
import { verifyRecords } from "./verify.js";

const source = { agent: "claude-code@alice", model: "claude-opus-4-8", commit: "a1b2c3d" };
const POLICY = loadPolicyFromText(`
defaults: { load: ask, propose: ask, on_write: pull_request }
paths:
  readable: ["facts/**"]
  writable: ["facts/**"]
  deny: []
`);

async function setupVaultWithFact(text: string): Promise<{ root: string; id: string; path: string }> {
  const base = await mkdtemp(join(tmpdir(), "cohort-verify-"));
  const root = join(base, "work");
  await git(["init", root]);
  await git(["-C", root, "symbolic-ref", "HEAD", "refs/heads/main"]);
  await git(["-C", root, "config", "user.name", "Human"]);
  await git(["-C", root, "config", "user.email", "human@example.com"]);
  await git(["-C", root, "config", "commit.gpgsign", "false"]);
  const record = createRecord({ kind: "fact", text, source });
  const path = `facts/${record.meta.id}.md`;
  await mkdir(join(root, "facts"), { recursive: true });
  await writeFile(join(root, path), serializeRecord(record));
  await git(["-C", root, "add", "-A"]);
  await git(["-C", root, "commit", "-m", "seed"]);
  return { root, id: record.meta.id, path };
}

test("verify promotes a quarantined record and commits the change", async () => {
  const { root, id, path } = await setupVaultWithFact("API gateway rate-limits at 100 req/s.");
  const results = await verifyRecords(root, [id], "alice");
  assert.equal(results[0]?.status, "verified");

  const record = parseRecord(await readVaultFile(root, path));
  assert.equal(record.meta.status, "verified");
  assert.equal(record.meta.verified_by, "alice");

  const message = await git(["-C", root, "log", "-1", "--format=%s"]);
  assert.match(message, /verify/);
});

test("verify is idempotent and reports not-found", async () => {
  const { root, id } = await setupVaultWithFact("Some fact.");
  assert.equal((await verifyRecords(root, [id], "alice"))[0]?.status, "verified");
  assert.equal((await verifyRecords(root, [id], "alice"))[0]?.status, "already-verified");
  assert.equal((await verifyRecords(root, ["f-ffffffffffff"], "alice"))[0]?.status, "not-found");
});

test("a verified record then loads as verified-first", async () => {
  const { root, id } = await setupVaultWithFact("Verified after promotion.");
  await verifyRecords(root, [id], "alice");
  const result = await loadContext(root, POLICY, "claude-code@bob");
  assert.match(result.text, /verified by alice/);
  assert.match(result.text, /1 verified, 0 unverified/);
});
