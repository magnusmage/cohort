import assert from "node:assert/strict";
import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  detectContradiction,
  hasNegation,
  loadVerifiedFacts,
  significantTerms,
} from "./contradiction.js";
import { git, revParse } from "./git.js";
import { runGate } from "./gate.js";
import { loadPolicyFromText } from "./policy.js";
import { type VaultRecord, createRecord, serializeRecord } from "./record.js";
import type { ScanResult, SecretScanner } from "./scan.js";

const source = { agent: "claude-code@alice", model: "claude-opus-4-8", commit: "a1b2c3d" };
const AGENT = "claude-code@bob";
const clean = { scan: async (): Promise<ScanResult> => ({ clean: true, findings: [] }) } satisfies SecretScanner;

function verifiedFact(text: string): VaultRecord {
  const rec = createRecord({ kind: "fact", text, source });
  rec.meta.status = "verified";
  rec.meta.verified_by = "alice";
  return rec;
}

function fact(text: string): VaultRecord {
  return createRecord({ kind: "fact", text, source });
}

test("hasNegation spots common negation cues and stays quiet otherwise", () => {
  assert.equal(hasNegation("Postgres is not the primary store."), true);
  assert.equal(hasNegation("Never use eval in request handlers."), true);
  assert.equal(hasNegation("We don't deploy on Fridays."), true);
  assert.equal(hasNegation("Avoid global mutable state."), true);
  assert.equal(hasNegation("Postgres is the primary store."), false);
  assert.equal(hasNegation("Deploy on Fridays after review."), false);
});

test("significantTerms drops stopwords, negation, and short tokens", () => {
  const terms = significantTerms("Postgres is not the primary store");
  assert.ok(terms.has("postgres"));
  assert.ok(terms.has("primary"));
  assert.ok(terms.has("store"));
  assert.ok(!terms.has("not"));
  assert.ok(!terms.has("the"));
  assert.ok(!terms.has("is"));
});

test("detectContradiction flags a same-topic opposite-polarity fact", () => {
  const candidate = fact("Postgres is not the primary store.");
  const r = detectContradiction(candidate, [verifiedFact("Postgres is the primary store.")]);
  assert.equal(r.conflict, true);
  assert.match(r.reason ?? "", /contradicts verified fact/);
  assert.match(r.reason ?? "", /opposite polarity/);
});

test("detectContradiction ignores the same assertion restated", () => {
  const candidate = fact("Postgres is the primary store for the app.");
  const r = detectContradiction(candidate, [verifiedFact("Postgres is the primary store.")]);
  assert.equal(r.conflict, false);
});

test("detectContradiction ignores an unrelated fact", () => {
  const candidate = fact("Never deploy on Fridays.");
  const r = detectContradiction(candidate, [verifiedFact("Postgres is the primary store.")]);
  assert.equal(r.conflict, false);
});

test("detectContradiction only compares against verified facts", () => {
  const candidate = fact("Postgres is not the primary store.");
  const quarantined = fact("Postgres is the primary store."); // status quarantined by default
  assert.equal(detectContradiction(candidate, [quarantined]).conflict, false);
});

test("detectContradiction does not judge decisions or threads", () => {
  const candidate = createRecord({ kind: "decision", text: "Do not adopt Postgres.", source });
  assert.equal(detectContradiction(candidate, [verifiedFact("Adopt Postgres everywhere.")]).conflict, false);
});

// Integration: a contradiction is held by the gate, never auto-landed.

const POLICY_AUTO_CLASS = `
defaults: { load: ask, propose: ask, on_write: pull_request }
classes:
  coding-convention: { propose: auto }
paths:
  readable: ["facts/**"]
  writable: ["facts/**"]
  deny: []
`;

async function setupRepo(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "cohort-contra-"));
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

test("the gate holds a contradicting fact that would otherwise auto-land", async () => {
  const root = await setupRepo();
  const before = await revParse(root, "main");
  const candidate = fact("Postgres is not the primary store.");
  const d = await runGate(
    root,
    loadPolicyFromText(POLICY_AUTO_CLASS),
    AGENT,
    { record: candidate, targetPath: `facts/${candidate.meta.id}.md`, declaredClass: "coding-convention" },
    { scanner: clean, verifiedFacts: async () => [verifiedFact("Postgres is the primary store.")] },
  );
  assert.equal(d.decision, "pending");
  assert.match(d.decision === "pending" ? d.reason : "", /contradicts verified fact/);
  assert.equal(await revParse(root, "main"), before, "main must be untouched");
  assert.equal(await exists(join(root, `facts/${candidate.meta.id}.md`)), false);
});

test("the gate still auto-lands a non-contradicting fact under the same policy", async () => {
  const root = await setupRepo();
  const candidate = fact("Redis caches session data for the web tier.");
  const d = await runGate(
    root,
    loadPolicyFromText(POLICY_AUTO_CLASS),
    AGENT,
    { record: candidate, targetPath: `facts/${candidate.meta.id}.md`, declaredClass: "coding-convention" },
    {
      scanner: clean,
      verifiedFacts: async () => [verifiedFact("Postgres is the primary store.")],
      prOpener: async ({ head }) => `https://example.test/pr/${head}`,
    },
  );
  assert.equal(d.decision, "landed");
});

test("loadVerifiedFacts reads only verified facts from the vault", async () => {
  const base = await mkdtemp(join(tmpdir(), "cohort-contra-load-"));
  const root = join(base, "work");
  await git(["init", root]);
  await git(["-C", root, "symbolic-ref", "HEAD", "refs/heads/main"]);
  await git(["-C", root, "config", "user.name", "T"]);
  await git(["-C", root, "config", "user.email", "t@e.com"]);
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(join(root, "facts"), { recursive: true });
  await writeFile(join(root, "facts", "v.md"), serializeRecord(verifiedFact("Postgres is the primary store.")));
  await writeFile(join(root, "facts", "q.md"), serializeRecord(fact("Redis is the cache.")));
  await mkdir(join(root, "decisions"), { recursive: true });
  const dec = createRecord({ kind: "decision", text: "Adopt Postgres.", source });
  dec.meta.status = "verified";
  dec.meta.verified_by = "alice";
  await writeFile(join(root, "decisions", "d.md"), serializeRecord(dec));
  await git(["-C", root, "add", "-A"]);
  await git(["-C", root, "commit", "-m", "seed"]);

  const facts = await loadVerifiedFacts(root);
  assert.equal(facts.length, 1, "only the verified fact, not the quarantined fact or the verified decision");
  assert.match(facts[0]?.text ?? "", /primary store/);
});

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
