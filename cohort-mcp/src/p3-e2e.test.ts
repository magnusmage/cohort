import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { captureSession } from "./capture.js";
import { git } from "./git.js";
import { loadPolicyFromText } from "./policy.js";
import { runProposals } from "./propose.js";
import type { ScanResult, SecretScanner } from "./scan.js";
import { searchVault } from "./search.js";
import { computeStats } from "./stats.js";
import { verifyRecords } from "./verify.js";

/**
 * Phase 3 integration: capture a session into drafts, run them through the
 * gate, verify one as a human, then find it with search and see it in stats.
 */

const source = { agent: "claude-code@alice", model: "claude-opus-4-8", commit: "a1b2c3d" };
const AGENT = "claude-code@alice";
const clean = { scan: async (): Promise<ScanResult> => ({ clean: true, findings: [] }) } satisfies SecretScanner;
const POLICY = loadPolicyFromText(`
defaults: { load: ask, propose: ask, on_write: direct_commit }
classes:
  coding-convention: { propose: auto }
paths:
  readable: ["facts/**"]
  writable: ["facts/**"]
  deny: []
`);

async function setupRepo(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "cohort-p3e2e-"));
  const remote = join(base, "remote.git");
  const work = join(base, "work");
  await git(["init", "--bare", remote]);
  await git(["clone", remote, work]);
  await git(["-C", work, "symbolic-ref", "HEAD", "refs/heads/main"]);
  await git(["-C", work, "config", "user.name", "Test"]);
  await git(["-C", work, "config", "user.email", "test@example.com"]);
  await git(["-C", work, "config", "commit.gpgsign", "false"]);
  await git(["-C", work, "commit", "--allow-empty", "-m", "init"]);
  await git(["-C", work, "push", "-u", "origin", "main"]);
  return work;
}

test("capture to propose to verify to search to stats", async () => {
  const root = await setupRepo();
  const { candidates } = captureSession(
    "Convention: always call git with argv arrays.\nFact: the gateway rate-limits at 100 req/s.",
    source,
  );
  assert.equal(candidates.length, 2);

  const results = await runProposals(root, POLICY, AGENT, candidates, { scanner: clean });
  const landed = results.find((r) => r.decision === "landed");
  const pending = results.find((r) => r.decision === "pending");
  assert.ok(landed, "the coding-convention draft auto-lands");
  assert.ok(pending, "the unclassified fact is held for approval");
  const id = landed?.id ?? "";

  // Landed record is quarantined: default search does not surface it yet.
  const beforeVerify = await searchVault(root, POLICY, AGENT, { query: "argv" });
  assert.equal(beforeVerify.count, 0);
  const quarantined = await searchVault(root, POLICY, AGENT, { query: "argv", includeQuarantined: true });
  assert.equal(quarantined.count, 1);

  // A human verifies it; now default search finds it.
  await verifyRecords(root, [id], "alice");
  const afterVerify = await searchVault(root, POLICY, AGENT, { query: "argv" });
  assert.equal(afterVerify.count, 1);
  assert.equal(afterVerify.hits[0]?.status, "verified");

  // Stats reflect the landed record and the writeback commits.
  const s = await computeStats(root, POLICY, AGENT);
  assert.equal(s.records.total, 1);
  assert.equal(s.records.byStatus.verified, 1);
  assert.ok(s.writebacks.recordCommits >= 1);
});
