import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { BRIDGE_TARGETS, generateBridge } from "./bridge.js";
import { git } from "./git.js";
import { createRecord, serializeRecord } from "./record.js";

const source = { agent: "claude-code@alice", model: "claude-opus-4-8", commit: "a1b2c3d" };

async function vaultWith(
  records: Array<{ path: string; kind: "fact" | "decision" | "thread"; text: string; status?: string; verifiedBy?: string }>,
): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "cohort-bridge-"));
  const root = join(base, "work");
  await git(["init", root]);
  await git(["-C", root, "symbolic-ref", "HEAD", "refs/heads/main"]);
  await git(["-C", root, "config", "user.name", "T"]);
  await git(["-C", root, "config", "user.email", "t@e.com"]);
  for (const r of records) {
    const rec = createRecord({ kind: r.kind, text: r.text, source });
    if (r.status) rec.meta.status = r.status as typeof rec.meta.status;
    if (r.verifiedBy) rec.meta.verified_by = r.verifiedBy;
    const abs = join(root, r.path);
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, serializeRecord(rec));
  }
  await git(["-C", root, "add", "-A"]);
  await git(["-C", root, "commit", "-m", "seed"]);
  return root;
}

const RECORDS: Array<{ path: string; kind: "fact" | "decision" | "thread"; text: string; status?: string; verifiedBy?: string }> = [
  { path: "decisions/vd.md", kind: "decision", text: "Adopt Postgres for the primary store.", status: "verified", verifiedBy: "alice" },
  { path: "facts/vf.md", kind: "fact", text: "Gateway rate-limits at 100 req/s.", status: "verified", verifiedBy: "alice" },
  { path: "facts/qf.md", kind: "fact", text: "Unverified agent claim." },
  { path: "facts/sf.md", kind: "fact", text: "Old superseded claim.", status: "superseded" },
];

test("generates verified-only content into all targets, identical across files", async () => {
  const root = await vaultWith(RECORDS);
  const { body, written } = await generateBridge(root);
  assert.deepEqual(written, [...BRIDGE_TARGETS]);
  assert.match(body, /Adopt Postgres/);
  assert.match(body, /Gateway rate-limits/);
  assert.doesNotMatch(body, /Unverified agent claim/, "quarantined excluded by default");
  assert.doesNotMatch(body, /Old superseded claim/, "superseded excluded");
  assert.match(body, /## Decisions/);
  assert.match(body, /## Conventions and facts/);
  for (const target of BRIDGE_TARGETS) {
    assert.equal(await readFile(join(root, target), "utf8"), body, `${target} matches the canonical body`);
  }
});

test("regenerating is idempotent (byte-identical)", async () => {
  const root = await vaultWith(RECORDS);
  await generateBridge(root);
  const first = await readFile(join(root, "AGENTS.md"), "utf8");
  await generateBridge(root);
  const second = await readFile(join(root, "AGENTS.md"), "utf8");
  assert.equal(first, second);
});

test("include-quarantined widens the generated content", async () => {
  const root = await vaultWith(RECORDS);
  const { body } = await generateBridge(root, { includeQuarantined: true });
  assert.match(body, /Unverified agent claim/);
  assert.doesNotMatch(body, /Old superseded claim/, "superseded still excluded");
});
