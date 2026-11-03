import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { git } from "./git.js";
import { createRecord, serializeRecord } from "./record.js";
import { computeReport, esc, renderReport } from "./report.js";

const source = { agent: "claude-code@alice", model: "claude-opus-4-8", commit: "a1b2c3d" };

interface Over {
  status?: "proposed" | "quarantined" | "verified" | "superseded";
  review_by?: string;
  verified_by?: string;
}

async function write(root: string, path: string, kind: "fact" | "decision" | "thread", text: string, over: Over = {}): Promise<void> {
  const rec = createRecord({ kind, text, source });
  if (over.status) rec.meta.status = over.status;
  if (over.review_by) rec.meta.review_by = over.review_by;
  if (over.verified_by) rec.meta.verified_by = over.verified_by;
  const abs = join(root, path);
  await mkdir(join(abs, ".."), { recursive: true });
  await writeFile(abs, serializeRecord(rec));
}

async function setupVault(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "cohort-report-"));
  const root = join(base, "work");
  await git(["init", root]);
  await git(["-C", root, "symbolic-ref", "HEAD", "refs/heads/main"]);
  await git(["-C", root, "config", "user.name", "Writer"]);
  await git(["-C", root, "config", "user.email", "w@e.com"]);
  // A contradicting pair of verified facts, one carrying HTML to exercise escaping.
  await write(root, "facts/a.md", "fact", "The <b>store</b> is Postgres.", { status: "verified", verified_by: "alice" });
  await write(root, "facts/b.md", "fact", "The store is not Postgres.", { status: "verified", verified_by: "alice" });
  // A quarantined fact and a quarantined decision.
  await write(root, "facts/c.md", "fact", "A quarantined fact about caching.");
  await write(root, "decisions/d.md", "decision", "Use structured logging.");
  // A verified but overdue record on an unrelated topic.
  await write(root, "facts/e.md", "fact", "Deploys run on Fridays.", { status: "verified", verified_by: "alice", review_by: "2000-01-01" });
  await git(["-C", root, "add", "-A"]);
  await git(["-C", root, "commit", "-m", "memory: add records"]);
  return root;
}

test("computeReport derives coverage, contradictions, staleness, people, and latency", async () => {
  const root = await setupVault();
  const d = await computeReport(root);

  assert.equal(d.totals.total, 5);
  assert.equal(d.totals.byKind.fact, 4);
  assert.equal(d.totals.byKind.decision, 1);
  assert.equal(d.totals.byStatus.verified, 3);
  assert.equal(d.totals.byStatus.quarantined, 2);

  // The Postgres pair is the one contradiction, reported once.
  assert.equal(d.contradictions.length, 1);
  const c = d.contradictions[0]!;
  assert.ok(c.aId.startsWith("f-") && c.bId.startsWith("f-"), "both are facts");
  assert.notEqual(c.aId, c.bId);
  const texts = `${c.aText} ${c.bText}`;
  assert.ok(texts.includes("Postgres") && texts.includes("not Postgres"), "the pair is the Postgres facts");
  assert.ok(c.reason.includes("opposite polarity"));

  // Only the overdue record is stale.
  assert.equal(d.stale.length, 1);
  assert.ok(d.stale[0]!.daysOverdue > 0);

  // Everyone proposed as the same agent; alice approved the three verified records.
  assert.equal(d.people.proposers[0]!.name, "claude-code@alice");
  assert.equal(d.people.proposers[0]!.count, 5);
  assert.equal(d.people.approvers[0]!.name, "alice");
  assert.equal(d.people.approvers[0]!.count, 3);

  // Latency is measured for the verified records from git history.
  assert.equal(d.latency.verifiedCount, 3);
  assert.equal(d.latency.measured, 3);
  assert.notEqual(d.latency.avgDays, null);
  assert.ok((d.latency.avgDays as number) >= 0);
});

test("renderReport returns self-contained HTML and escapes record text", async () => {
  const root = await setupVault();
  const d = await computeReport(root);
  const html = renderReport(d);

  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes("Cohort vault health"));
  assert.ok(html.includes(root), "names the vault path");
  // No external requests: no http(s) links and no script tags in the document.
  assert.ok(!/<script/i.test(html), "no script tags");
  assert.ok(!/https?:\/\//i.test(html), "no network requests");
  // The record's literal <b> must be escaped, never emitted as markup.
  assert.ok(html.includes("&lt;b&gt;store&lt;/b&gt;"));
  assert.ok(!html.includes("<b>store</b>"));
});

test("esc escapes the HTML metacharacters", () => {
  assert.equal(esc("<script>\"'&"), "&lt;script&gt;&quot;&#39;&amp;");
  assert.equal(esc(42), "42");
});

test("computeReport is clean on an empty vault", async () => {
  const base = await mkdtemp(join(tmpdir(), "cohort-report-empty-"));
  const root = join(base, "work");
  await git(["init", root]);
  await git(["-C", root, "config", "user.name", "W"]);
  await git(["-C", root, "config", "user.email", "w@e.com"]);
  const d = await computeReport(root);
  assert.equal(d.totals.total, 0);
  assert.equal(d.contradictions.length, 0);
  assert.equal(d.stale.length, 0);
  assert.equal(d.latency.measured, 0);
  const html = renderReport(d);
  assert.ok(html.includes("No contradictions among verified facts."));
  assert.ok(html.includes("Nothing overdue for review."));
});
