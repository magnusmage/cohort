import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { git, revParse } from "./git.js";
import { loadPolicyFromText } from "./policy.js";
import { type ProposeDeps, runProposals } from "./propose.js";
import type { ScanResult, SecretScanner } from "./scan.js";

const AGENT = "claude-code@alice";

const POLICY = loadPolicyFromText(`
defaults: { load: ask, propose: ask, on_write: pull_request }
classes:
  coding-convention: { propose: auto }
  secret-or-credential: { propose: never }
paths:
  readable: ["facts/**"]
  writable: ["facts/**"]
  deny: []
`);

const clean = { scan: async (): Promise<ScanResult> => ({ clean: true, findings: [] }) } satisfies SecretScanner;

async function setupRepo(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "cohort-propose-"));
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

const deps = (prOpener?: ProposeDeps["prOpener"]): ProposeDeps =>
  prOpener ? { scanner: clean, prOpener } : { scanner: clean };

test("a fact with no class is held for approval, nothing lands", async () => {
  const root = await setupRepo();
  const before = await revParse(root, "main");
  const results = await runProposals(root, POLICY, AGENT, [{ kind: "fact", text: "Rate limit is 100 req/s." }], deps());
  assert.equal(results[0]?.decision, "pending");
  assert.ok(results[0]?.handle);
  assert.equal(await revParse(root, "main"), before);
});

test("a coding-convention record auto-lands as a PR carrying provenance", async () => {
  const root = await setupRepo();
  const before = await revParse(root, "main");
  const results = await runProposals(
    root,
    POLICY,
    AGENT,
    [{ kind: "fact", text: "Always use argv arrays for shell-outs.", class: "coding-convention" }],
    deps(async ({ head }) => `https://example.test/pr/${head}`),
  );
  const r = results[0];
  assert.equal(r?.decision, "landed");
  assert.equal(r?.mode, "pull_request");
  assert.match(r?.prUrl ?? "", /example\.test/);
  assert.equal(await revParse(root, "main"), before, "main stays untouched for a PR");
  const committed = await git(["-C", root, "show", `${r?.branch}:facts/${r?.id}.md`]);
  assert.match(committed, /agent: claude-code@alice/, "provenance is stamped in the committed record");
});

test("a secret-or-credential proposal is hard-rejected", async () => {
  const root = await setupRepo();
  const results = await runProposals(
    root,
    POLICY,
    AGENT,
    [{ kind: "fact", text: "anything", class: "secret-or-credential" }],
    deps(),
  );
  assert.equal(results[0]?.decision, "rejected");
  assert.match(results[0]?.reason ?? "", /hard-denied/);
});

test("an invalid record is rejected with a reason", async () => {
  const root = await setupRepo();
  const results = await runProposals(root, POLICY, AGENT, [{ kind: "fact", text: "" }], deps());
  assert.equal(results[0]?.decision, "rejected");
  assert.match(results[0]?.reason ?? "", /invalid record/);
});
