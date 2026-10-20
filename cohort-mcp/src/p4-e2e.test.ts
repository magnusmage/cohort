import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { generateBridge } from "./bridge.js";
import { git, revParse } from "./git.js";
import { loadPolicyFromText } from "./policy.js";
import { createRecord, parseRecord, serializeRecord } from "./record.js";
import { reabsorb } from "./reabsorb.js";
import type { ScanResult, SecretScanner } from "./scan.js";
import { exportVault, importVault, parsePortable, serializePortable } from "./portable.js";

/**
 * Phase 4 integration: generate the bridge files from the vault, reabsorb a
 * hand edit through the gate, and round-trip the vault through export/import.
 */

const source = { agent: "claude-code@alice", model: "claude-opus-4-8", commit: "a1b2c3d" };
const AGENT = "claude-code@bob";
const clean = { scan: async (): Promise<ScanResult> => ({ clean: true, findings: [] }) } satisfies SecretScanner;
const POLICY = loadPolicyFromText(`
defaults: { load: ask, propose: ask, on_write: pull_request }
paths:
  readable: ["facts/**", "decisions/**"]
  writable: ["facts/**", "decisions/**"]
  deny: []
`);

async function setupVault(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "cohort-p4e2e-"));
  const root = join(base, "work");
  await git(["init", root]);
  await git(["-C", root, "symbolic-ref", "HEAD", "refs/heads/main"]);
  await git(["-C", root, "config", "user.name", "T"]);
  await git(["-C", root, "config", "user.email", "t@e.com"]);
  const rec = createRecord({ kind: "decision", text: "Adopt Postgres for the primary store.", source });
  rec.meta.status = "verified";
  rec.meta.verified_by = "alice";
  await mkdir(join(root, "decisions"), { recursive: true });
  await writeFile(join(root, "decisions", "d.md"), serializeRecord(rec));
  await git(["-C", root, "add", "-A"]);
  await git(["-C", root, "commit", "-m", "seed"]);
  return root;
}

test("bridge, then reabsorb a hand edit, then round-trip export/import", async () => {
  const root = await setupVault();

  // Generate the bridge files from the verified record.
  const { body } = await generateBridge(root);
  assert.match(body, /Adopt Postgres/);

  // A human appends a new decision to AGENTS.md; reabsorb proposes only the new one.
  const edited = `${body}- Use feature flags for risky changes.\n`;
  const before = await revParse(root, "main");
  const { newItems, results } = await reabsorb(root, POLICY, AGENT, edited, { scanner: clean });
  assert.equal(newItems.length, 1);
  assert.equal(results[0]?.decision, "pending", "the hand edit is held, not written back");
  assert.equal(await revParse(root, "main"), before);

  // Round-trip the vault through the portable format.
  const pv = await exportVault(root);
  assert.deepStrictEqual(parsePortable(serializePortable(pv)), pv);
  const dest = await mkdtemp(join(tmpdir(), "cohort-p4e2e-dest-"));
  const written = await importVault(dest, pv);
  const reread = parseRecord(await readFile(join(dest, written[0] ?? ""), "utf8"));
  assert.deepStrictEqual(reread, pv.records[0]);
});
