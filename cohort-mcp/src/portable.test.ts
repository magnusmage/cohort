import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { git } from "./git.js";
import { type VaultRecord, createRecord, parseRecord, serializeRecord } from "./record.js";
import { PORTABLE_VERSION, exportVault, importVault, parsePortable, serializePortable } from "./portable.js";

const source = { agent: "claude-code@alice", model: "claude-opus-4-8", commit: "a1b2c3d" };

async function vaultWith(
  records: Array<{ path: string; kind: "fact" | "decision" | "thread"; text: string; status?: string; verifiedBy?: string }>,
): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "cohort-portable-"));
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
  { path: "facts/a.md", kind: "fact", text: "Fact A, verified.", status: "verified", verifiedBy: "alice" },
  { path: "decisions/b.md", kind: "decision", text: "Decision B, quarantined." },
  { path: "threads/c.md", kind: "thread", text: "Thread C, superseded.", status: "superseded" },
];

test("export captures every record, deterministically sorted", async () => {
  const root = await vaultWith(RECORDS);
  const pv = await exportVault(root);
  assert.equal(pv.version, PORTABLE_VERSION);
  assert.equal(pv.records.length, 3);
  const ids = pv.records.map((r) => r.meta.id);
  assert.deepEqual(ids, [...ids].sort());
});

test("serialize then parse is lossless", async () => {
  const root = await vaultWith(RECORDS);
  const pv = await exportVault(root);
  assert.deepStrictEqual(parsePortable(serializePortable(pv)), pv);
});

test("export then import into a fresh vault reconstructs the records exactly", async () => {
  const root = await vaultWith(RECORDS);
  const pv = await exportVault(root);

  const dest = await mkdtemp(join(tmpdir(), "cohort-import-"));
  const written = await importVault(dest, pv);
  assert.equal(written.length, 3);

  const reread: VaultRecord[] = [];
  for (const path of written) reread.push(parseRecord(await readFile(join(dest, path), "utf8")));
  assert.deepStrictEqual(reread, pv.records);
});

test("parse rejects an unsupported version and a malformed record", () => {
  assert.throws(() => parsePortable('{"version":"9","records":[]}'), /unsupported portable vault version/);
  assert.throws(() => parsePortable('{"version":"1","records":[{"meta":{},"text":"x"}]}'), /invalid record frontmatter/);
});
