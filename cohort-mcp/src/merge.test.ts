import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { git, readVaultFile, revParse } from "./git.js";
import { runGate } from "./gate.js";
import { classifyAgainstExisting } from "./merge.js";
import { loadPolicyFromText } from "./policy.js";
import { type VaultRecord, createRecord, parseRecord, serializeRecord } from "./record.js";
import type { ScanResult, SecretScanner } from "./scan.js";

const source = { agent: "claude-code@alice", model: "claude-opus-4-8", commit: "a1b2c3d" };
const AGENT = "claude-code@bob";
const clean = { scan: async (): Promise<ScanResult> => ({ clean: true, findings: [] }) } satisfies SecretScanner;

const POLICY_AUTO_CLASS = `
defaults: { load: ask, propose: ask, on_write: pull_request }
classes:
  coding-convention: { propose: auto }
paths:
  readable: ["facts/**"]
  writable: ["facts/**"]
  deny: []
`;

function verified(text: string): VaultRecord {
  const rec = createRecord({ kind: "fact", text, source });
  rec.meta.status = "verified";
  rec.meta.verified_by = "alice";
  return rec;
}

async function setupRepo(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "cohort-merge-"));
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

async function seed(root: string, path: string, record: VaultRecord): Promise<void> {
  const abs = join(root, path);
  await mkdir(join(abs, ".."), { recursive: true });
  await writeFile(abs, serializeRecord(record));
  await git(["-C", root, "add", "-A"]);
  await git(["-C", root, "commit", "-m", `seed ${path}`]);
}

test("classifyAgainstExisting: absent when the path is empty", async () => {
  const root = await setupRepo();
  const incoming = createRecord({ kind: "fact", text: "New fact.", source });
  assert.deepEqual(await classifyAgainstExisting(root, `facts/${incoming.meta.id}.md`, incoming), { kind: "absent" });
});

test("classifyAgainstExisting: duplicate reports the existing status", async () => {
  const root = await setupRepo();
  const rec = verified("Shared fact.");
  await seed(root, `facts/${rec.meta.id}.md`, rec);
  const incoming = createRecord({ kind: "fact", text: "Shared fact.", source }); // same id, quarantined
  const c = await classifyAgainstExisting(root, `facts/${rec.meta.id}.md`, incoming);
  assert.equal(c.kind, "duplicate");
  assert.equal(c.kind === "duplicate" ? c.existingStatus : "", "verified");
});

test("classifyAgainstExisting: conflict when a different record occupies the path", async () => {
  const root = await setupRepo();
  const incoming = createRecord({ kind: "fact", text: "Text A.", source });
  const other = createRecord({ kind: "fact", text: "Text B entirely different.", source });
  await seed(root, `facts/${incoming.meta.id}.md`, other); // wrong record parked at the path
  const c = await classifyAgainstExisting(root, `facts/${incoming.meta.id}.md`, incoming);
  assert.equal(c.kind, "conflict");
  assert.match(c.kind === "conflict" ? c.reason : "", new RegExp(other.meta.id));
});

test("classifyAgainstExisting: conflict on an unparseable file", async () => {
  const root = await setupRepo();
  const incoming = createRecord({ kind: "fact", text: "Text A.", source });
  const abs = join(root, `facts/${incoming.meta.id}.md`);
  await mkdir(join(abs, ".."), { recursive: true });
  await writeFile(abs, "not a record");
  const c = await classifyAgainstExisting(root, `facts/${incoming.meta.id}.md`, incoming);
  assert.equal(c.kind, "conflict");
});

test("the gate dedups a re-proposal and never clobbers a verified record", async () => {
  const root = await setupRepo();
  const rec = verified("API gateway rate-limits at 100 req/s per key.");
  await seed(root, `facts/${rec.meta.id}.md`, rec);
  const mainBefore = await revParse(root, "main");

  const incoming = createRecord({ kind: "fact", text: "API gateway rate-limits at 100 req/s per key.", source });
  const d = await runGate(
    root,
    loadPolicyFromText(POLICY_AUTO_CLASS),
    AGENT,
    { record: incoming, targetPath: `facts/${incoming.meta.id}.md`, declaredClass: "coding-convention" },
    { scanner: clean },
  );
  assert.equal(d.decision, "duplicate");
  assert.match(d.decision === "duplicate" ? d.reason : "", /status: verified/);
  assert.equal(await revParse(root, "main"), mainBefore, "main must be untouched");
  // The file on disk is still the verified record, not a fresh quarantined one.
  assert.equal(parseRecord(await readVaultFile(root, `facts/${rec.meta.id}.md`)).meta.status, "verified");
});

test("the gate surfaces a real path conflict instead of overwriting", async () => {
  const root = await setupRepo();
  const incoming = createRecord({ kind: "fact", text: "Text A.", source });
  const other = createRecord({ kind: "fact", text: "Text B entirely different.", source });
  await seed(root, `facts/${incoming.meta.id}.md`, other);
  const mainBefore = await revParse(root, "main");
  const d = await runGate(
    root,
    loadPolicyFromText(POLICY_AUTO_CLASS),
    AGENT,
    { record: incoming, targetPath: `facts/${incoming.meta.id}.md`, declaredClass: "coding-convention" },
    { scanner: clean },
  );
  assert.equal(d.decision, "conflict");
  assert.equal(await revParse(root, "main"), mainBefore);
});
