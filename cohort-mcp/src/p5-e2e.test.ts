import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { git } from "./git.js";
import { buildIndex, indexStatus, writeIndex } from "./indexer.js";
import { loadContext } from "./load.js";
import { loadPolicyFromText } from "./policy.js";
import { type VaultRecord, createRecord, serializeRecord } from "./record.js";
import { runProposals } from "./propose.js";
import type { ScanResult, SecretScanner } from "./scan.js";
import { supersedeRecord } from "./supersede.js";
import { explainRecord } from "./why.js";

/**
 * Phase 5 integration: build the retrieval index, load under a token budget,
 * hold a contradiction, dedup a re-proposal, supersede a record out of load,
 * and read a record's provenance, all over one vault.
 */

const source = { agent: "claude-code@alice", model: "claude-opus-4-8", commit: "a1b2c3d" };
const AGENT = "claude-code@bob";
const clean = { scan: async (): Promise<ScanResult> => ({ clean: true, findings: [] }) } satisfies SecretScanner;

const POLICY = loadPolicyFromText(`
defaults: { load: ask, propose: ask, on_write: pull_request }
paths:
  readable: ["facts/**", "decisions/**"]
  writable: ["facts/**"]
  deny: []
`);

function verifiedFact(text: string): VaultRecord {
  const rec = createRecord({ kind: "fact", text, source });
  rec.meta.status = "verified";
  rec.meta.verified_by = "alice";
  return rec;
}

async function commit(root: string, msg: string): Promise<void> {
  await git(["-C", root, "add", "-A"]);
  await git(["-C", root, "commit", "-m", msg]);
}

async function setupVault(): Promise<{ root: string; primary: VaultRecord }> {
  const base = await mkdtemp(join(tmpdir(), "cohort-p5e2e-"));
  const root = join(base, "work");
  await git(["init", root]);
  await git(["-C", root, "symbolic-ref", "HEAD", "refs/heads/main"]);
  await git(["-C", root, "config", "user.name", "Alice Reviewer"]);
  await git(["-C", root, "config", "user.email", "alice@example.com"]);
  await mkdir(join(root, "facts"), { recursive: true });

  const primary = verifiedFact("Postgres is the primary store.");
  await writeFile(join(root, "facts", `${primary.meta.id}.md`), serializeRecord(primary));
  // A few bulky verified facts, to exercise the token budget.
  for (let i = 0; i < 3; i += 1) {
    const r = verifiedFact(`Bulk fact ${i}: ${"word ".repeat(200)}`);
    await writeFile(join(root, "facts", `${r.meta.id}.md`), serializeRecord(r));
  }
  await commit(root, "seed");
  return { root, primary };
}

test("the moat features work together over one vault", async () => {
  const { root, primary } = await setupVault();

  // 1. Build and commit the retrieval index; it is in sync with the vault.
  await writeIndex(root, await buildIndex(root));
  await commit(root, "index");
  assert.equal((await indexStatus(root)).inSync, true);

  // 2. A small token budget bounds the load and stays under the cap.
  const bounded = await loadContext(root, POLICY, AGENT, { tokenBudget: 300 });
  assert.ok(bounded.approxTokens <= 300, `used ${bounded.approxTokens} must stay within 300`);
  assert.ok(bounded.withheld > 0, "bulky records beyond the budget are withheld");

  // 3. A contradicting fact is held for a human, not landed.
  const contra = await runProposals(root, POLICY, AGENT, [{ kind: "fact", text: "Postgres is not the primary store." }], {
    scanner: clean,
  });
  assert.equal(contra[0]?.decision, "pending");
  assert.match(contra[0]?.reason ?? "", /contradicts verified fact/);

  // 4. Re-proposing the verified fact dedups instead of clobbering it.
  const dup = await runProposals(root, POLICY, AGENT, [{ kind: "fact", text: "Postgres is the primary store." }], {
    scanner: clean,
  });
  assert.equal(dup[0]?.decision, "duplicate");
  assert.match(dup[0]?.reason ?? "", /status: verified/);

  // 5. Supersession drops the old record from load but keeps it in git.
  const replacement = verifiedFact("Postgres 16 is the primary store.");
  await writeFile(join(root, "facts", `${replacement.meta.id}.md`), serializeRecord(replacement));
  await commit(root, "add replacement");
  const sup = await supersedeRecord(root, primary.meta.id, replacement.meta.id);
  assert.equal(sup.status, "superseded");
  const afterSupersede = await loadContext(root, POLICY, AGENT, { tokenBudget: 8000 });
  assert.doesNotMatch(afterSupersede.text, /Postgres is the primary store\./);
  assert.match(afterSupersede.text, /Postgres 16 is the primary store/);
  const tracked = await git(["-C", root, "ls-files", `facts/${primary.meta.id}.md`]);
  assert.equal(tracked.trim(), `facts/${primary.meta.id}.md`, "the superseded record stays in git");

  // 6. cohort_why returns provenance read from git for the replacement.
  const why = await explainRecord(root, replacement.meta.id);
  assert.equal(why.found, true);
  assert.equal(why.claimed?.agent, "claude-code@alice");
  assert.ok((why.history?.commitCount ?? 0) >= 1);
  assert.equal(why.history?.firstSeen?.author, "Alice Reviewer");
});
