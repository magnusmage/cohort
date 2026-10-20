import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { captureSession, extractCandidates } from "./capture.js";
import { git } from "./git.js";
import { loadPolicyFromText } from "./policy.js";
import { runProposals } from "./propose.js";
import type { ScanResult, SecretScanner } from "./scan.js";

const source = { agent: "claude-code@alice", model: "claude-opus-4-8", commit: "a1b2c3d" };

const SESSION = [
  "# Session notes",
  "Decision: adopt Postgres for the primary store.",
  "Convention: always call git with argv arrays.",
  "Fact: the gateway rate-limits at 100 req/s.",
  "Open: migrate the billing service.",
  "Just some chatter that should not be captured.",
].join("\n");

test("extracts and classifies candidates from marked lines only", () => {
  const candidates = extractCandidates(SESSION);
  assert.equal(candidates.length, 4);
  assert.deepEqual(
    candidates.map((c) => [c.kind, c.class]),
    [
      ["decision", "architecture-decision"],
      ["fact", "coding-convention"],
      ["fact", undefined],
      ["thread", undefined],
    ],
  );
  assert.equal(candidates[0]?.text, "adopt Postgres for the primary store.");
});

test("drafts are quarantined with stamped provenance, and nothing is landed", () => {
  const { candidates, drafts } = captureSession(SESSION, source);
  assert.equal(drafts.length, candidates.length);
  for (const d of drafts) {
    assert.equal(d.meta.status, "quarantined");
    assert.equal(d.meta.source.agent, "claude-code@alice");
    assert.equal(d.meta.verified_by, null);
  }
});

test("captured drafts go through the gate and the secret scan", async () => {
  const base = await mkdtemp(join(tmpdir(), "cohort-capture-"));
  const remote = join(base, "remote.git");
  const work = join(base, "work");
  await git(["init", "--bare", remote]);
  await git(["clone", remote, work]);
  await git(["-C", work, "symbolic-ref", "HEAD", "refs/heads/main"]);
  await git(["-C", work, "config", "user.name", "T"]);
  await git(["-C", work, "config", "user.email", "t@e.com"]);
  await git(["-C", work, "config", "commit.gpgsign", "false"]);
  await git(["-C", work, "commit", "--allow-empty", "-m", "init"]);
  await git(["-C", work, "push", "-u", "origin", "main"]);

  const policy = loadPolicyFromText(`
defaults: { load: ask, propose: ask, on_write: direct_commit }
classes:
  coding-convention: { propose: auto }
paths:
  readable: ["facts/**"]
  writable: ["facts/**"]
  deny: []
`);
  const dirty = { scan: async (): Promise<ScanResult> => ({ clean: false, findings: ["aws-access-key"] }) } satisfies SecretScanner;

  const { candidates } = captureSession("Convention: here is a secret in a captured draft.", source);
  const results = await runProposals(work, policy, "claude-code@alice", candidates, { scanner: dirty });
  assert.equal(results[0]?.decision, "rejected");
  assert.match(results[0]?.reason ?? "", /secret or PII/);
});
