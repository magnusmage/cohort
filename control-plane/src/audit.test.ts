import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";

import { buildAudit } from "./audit.js";

const run = promisify(execFile);
const git = (args: string[]): Promise<unknown> => run("git", args);

function record(opts: { id: string; kind: string; status: string; added?: string; verifiedBy?: string | null }): string {
  const fm = [
    `id: ${opts.id}`,
    `kind: ${opts.kind}`,
    `status: ${opts.status}`,
    `added: ${opts.added ?? "2026-01-01"}`,
    `verified_by: ${opts.verifiedBy ?? "null"}`,
  ].join("\n");
  return `---\n${fm}\n---\nbody text\n`;
}

async function vault(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "cohort-cp-audit-"));
  const root = join(base, "work");
  await git(["init", root]);
  await git(["-C", root, "symbolic-ref", "HEAD", "refs/heads/main"]);
  await git(["-C", root, "config", "user.name", "Alice"]);
  await git(["-C", root, "config", "user.email", "alice@example.com"]);
  await mkdir(join(root, "facts"), { recursive: true });
  await mkdir(join(root, "decisions"), { recursive: true });
  await writeFile(join(root, "facts", "f-aaaaaaaaaaaa.md"), record({ id: "f-aaaaaaaaaaaa", kind: "fact", status: "verified", verifiedBy: "alice" }));
  await writeFile(join(root, "facts", "f-bbbbbbbbbbbb.md"), record({ id: "f-bbbbbbbbbbbb", kind: "fact", status: "quarantined" }));
  await writeFile(join(root, "decisions", "d-cccccccccccc.md"), record({ id: "d-cccccccccccc", kind: "decision", status: "verified", verifiedBy: "bob" }));
  await writeFile(join(root, "facts", "broken.md"), "not a record");
  await git(["-C", root, "add", "-A"]);
  await git(["-C", root, "commit", "-m", "memory: seed"]);
  return root;
}

test("buildAudit summarizes counts, records, and writebacks read-only from git", async () => {
  const root = await vault();
  const model = await buildAudit(root);
  assert.equal(model.source, "git");
  assert.equal(model.counts.byStatus.verified, 2);
  assert.equal(model.counts.byStatus.quarantined, 1);
  assert.equal(model.counts.byKind.fact, 2);
  assert.equal(model.counts.byKind.decision, 1);
  assert.equal(model.counts.unreadable, 1, "the broken file is counted unreadable, not guessed");
  assert.equal(model.records.length, 3);
  // Records are sorted by id.
  assert.deepEqual(model.records.map((r) => r.id), [...model.records.map((r) => r.id)].sort());
  assert.equal(model.records.find((r) => r.id === "f-aaaaaaaaaaaa")?.verified_by, "alice");
  assert.ok(model.writebacks.commits >= 1);
  assert.ok(model.writebacks.contributors >= 1);
  assert.match(model.note, /source of truth/);
});

test("buildAudit on an empty vault yields zero counts, not an error", async () => {
  const base = await mkdtemp(join(tmpdir(), "cohort-cp-empty-"));
  const root = join(base, "work");
  await git(["init", root]);
  await git(["-C", root, "symbolic-ref", "HEAD", "refs/heads/main"]);
  await git(["-C", root, "config", "user.name", "T"]);
  await git(["-C", root, "config", "user.email", "t@e.com"]);
  await git(["-C", root, "commit", "--allow-empty", "-m", "init"]);
  const model = await buildAudit(root);
  assert.equal(model.records.length, 0);
  assert.equal(model.counts.byStatus.verified, 0);
});
