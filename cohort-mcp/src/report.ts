import { git, listTracked, readVaultFile } from "./git.js";
import { detectContradiction } from "./contradiction.js";
import { type VaultRecord, parseRecord } from "./record.js";
import { isStale, todayStr } from "./staleness.js";

/**
 * cohort report: a vault health view you can see, generated on your machine.
 *
 * Everything here is derived from the vault files and git history, with no
 * network call and no server, the same honesty rule as `cohort stats`. The
 * report surfaces what git can prove (coverage, contradictions among verified
 * facts, overdue records, how long approvals took, and who proposes versus who
 * approves) and lists the figures it will not fabricate under "not tracked".
 *
 * The output is a single self-contained HTML file: inline styles, no scripts,
 * no external requests, safe to open straight from disk. Every value that comes
 * from a record is HTML-escaped before it reaches the page, so a record body
 * can never inject markup into the report.
 */

const RECORD_DIRS = ["facts", "decisions", "threads"];

type Kind = "fact" | "decision" | "thread";
type Status = "proposed" | "quarantined" | "verified" | "superseded";

interface LoadedRecord {
  record: VaultRecord;
  path: string;
}

export interface ReportData {
  vaultPath: string;
  generatedAt: string;
  totals: {
    total: number;
    byKind: Record<Kind, number>;
    byStatus: Record<Status, number>;
  };
  contradictions: { aId: string; bId: string; reason: string; aText: string; bText: string }[];
  stale: { id: string; kind: Kind; reviewBy: string; daysOverdue: number }[];
  latency: {
    verifiedCount: number;
    measured: number;
    avgDays: number | null;
    medianDays: number | null;
    slowest: { id: string; days: number }[];
  };
  people: {
    proposers: { name: string; count: number }[];
    approvers: { name: string; count: number }[];
  };
  writebacks: { recordCommits: number; contributors: number };
  notTracked: string[];
}

async function loadRecords(root: string): Promise<LoadedRecord[]> {
  const tracked = await listTracked(root, ".");
  const files = tracked.filter((f) => f.endsWith(".md") && RECORD_DIRS.some((d) => f.startsWith(`${d}/`)));
  const out: LoadedRecord[] = [];
  for (const f of files) {
    try {
      out.push({ record: parseRecord(await readVaultFile(root, f)), path: f });
    } catch {
      // A malformed record is skipped here; verify and the gate surface it elsewhere.
    }
  }
  return out;
}

/** Unique same-topic, opposite-polarity pairs among verified facts, built on the shared detector. */
function findContradictions(records: LoadedRecord[]): ReportData["contradictions"] {
  const verifiedFacts = records
    .map((r) => r.record)
    .filter((r) => r.meta.kind === "fact" && r.meta.status === "verified");
  const byId = new Map(verifiedFacts.map((r) => [r.meta.id, r] as const));
  const seen = new Set<string>();
  const pairs: ReportData["contradictions"] = [];
  for (const fact of verifiedFacts) {
    const hit = detectContradiction(fact, verifiedFacts);
    if (!hit.conflict || !hit.withId) continue;
    const pairId = [fact.meta.id, hit.withId].sort().join("|");
    if (seen.has(pairId)) continue;
    seen.add(pairId);
    const other = byId.get(hit.withId);
    pairs.push({
      aId: fact.meta.id,
      bId: hit.withId,
      reason: hit.reason ?? "same topic, opposite polarity",
      aText: snippet(fact.text),
      bText: other ? snippet(other.text) : "",
    });
  }
  return pairs;
}

function snippet(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function daysBetween(fromISO: string, toISO: string): number {
  const from = Date.parse(fromISO);
  const to = Date.parse(toISO);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

/**
 * When a record first became verified, read from git. The pickaxe finds the
 * commit that introduced the `status: verified` line into the file; the first
 * such commit is the approval. Returns null when git cannot show it (for
 * example an uncommitted record), so latency is measured only where git proves it.
 */
async function verifiedAt(root: string, path: string): Promise<string | null> {
  try {
    const out = await git([
      "-C", root, "log", "--reverse", "--format=%aI", "-S", "status: verified", "--", path,
    ]);
    const first = out.split("\n").find(Boolean);
    return first ?? null;
  } catch {
    return null;
  }
}

async function computeLatency(root: string, records: LoadedRecord[]): Promise<ReportData["latency"]> {
  const verified = records.filter((r) => r.record.meta.status === "verified");
  const measured: { id: string; days: number }[] = [];
  for (const r of verified) {
    const at = await verifiedAt(root, r.path);
    if (!at) continue;
    measured.push({ id: r.record.meta.id, days: daysBetween(`${r.record.meta.added}T00:00:00Z`, at) });
  }
  const days = measured.map((m) => m.days).sort((a, b) => a - b);
  const avg = days.length ? Math.round(days.reduce((s, d) => s + d, 0) / days.length) : null;
  const median = days.length ? days[Math.floor((days.length - 1) / 2)] ?? null : null;
  const slowest = [...measured].sort((a, b) => b.days - a.days).slice(0, 5);
  return { verifiedCount: verified.length, measured: measured.length, avgDays: avg, medianDays: median, slowest };
}

function tally(names: (string | null)[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const n of names) {
    if (!n) continue;
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1));
}

async function writebackHistory(root: string): Promise<{ recordCommits: number; contributors: number }> {
  try {
    const out = await git(["-C", root, "log", "--format=%an", "--", ...RECORD_DIRS]);
    const authors = out ? out.split("\n").filter(Boolean) : [];
    return { recordCommits: authors.length, contributors: new Set(authors).size };
  } catch {
    return { recordCommits: 0, contributors: 0 };
  }
}

/** Gather the report data from the vault and git. No network, no mutation. */
export async function computeReport(root: string, now: Date = new Date()): Promise<ReportData> {
  const records = await loadRecords(root);
  const byKind: Record<Kind, number> = { fact: 0, decision: 0, thread: 0 };
  const byStatus: Record<Status, number> = { proposed: 0, quarantined: 0, verified: 0, superseded: 0 };
  for (const { record } of records) {
    byKind[record.meta.kind] += 1;
    byStatus[record.meta.status] += 1;
  }

  const today = todayStr(now);
  const stale = records
    .filter((r) => isStale(r.record.meta, today))
    .map((r) => ({
      id: r.record.meta.id,
      kind: r.record.meta.kind,
      reviewBy: r.record.meta.review_by as string,
      daysOverdue: daysBetween(`${r.record.meta.review_by}T00:00:00Z`, `${today}T00:00:00Z`),
    }))
    .sort((a, b) => b.daysOverdue - a.daysOverdue);

  const people = {
    proposers: tally(records.map((r) => r.record.meta.source.agent)),
    approvers: tally(records.map((r) => r.record.meta.verified_by)),
  };

  return {
    vaultPath: root,
    generatedAt: now.toISOString(),
    totals: { total: records.length, byKind, byStatus },
    contradictions: findContradictions(records),
    stale,
    latency: await computeLatency(root, records),
    people,
    writebacks: await writebackHistory(root),
    notTracked: [
      "how often a record was actually loaded",
      "writebacks a human rejected",
      "re-explanations avoided",
    ],
  };
}

const ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escape every value that comes from a record before it reaches the page. */
export function esc(value: string | number): string {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPE[c] ?? c);
}

function bar(label: string, count: number, total: number, color: string): string {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return `<div class="row"><span class="k">${esc(label)}</span>`
    + `<span class="track"><span class="fill" style="width:${pct}%;background:${color}"></span></span>`
    + `<span class="v">${esc(count)}</span></div>`;
}

/** Render the report as a single self-contained HTML document. No scripts, no external requests. */
export function renderReport(d: ReportData): string {
  const t = d.totals;
  const coverage =
    bar("facts", t.byKind.fact, t.total, "#818cf8") +
    bar("decisions", t.byKind.decision, t.total, "#818cf8") +
    bar("threads", t.byKind.thread, t.total, "#818cf8");
  const statuses =
    bar("verified", t.byStatus.verified, t.total, "#22d3ee") +
    bar("proposed", t.byStatus.proposed, t.total, "#a5b4fc") +
    bar("quarantined", t.byStatus.quarantined, t.total, "#fbbf24") +
    bar("superseded", t.byStatus.superseded, t.total, "#64748b");

  const contradictions = d.contradictions.length
    ? d.contradictions
        .map(
          (c) =>
            `<li><code>${esc(c.aId)}</code> vs <code>${esc(c.bId)}</code><div class="muted">${esc(c.reason)}</div>` +
            `<div class="snip">${esc(c.aText)}</div><div class="snip">${esc(c.bText)}</div></li>`,
        )
        .join("")
    : `<li class="ok">No contradictions among verified facts.</li>`;

  const stale = d.stale.length
    ? d.stale
        .map(
          (s) =>
            `<li><code>${esc(s.id)}</code> <span class="muted">${esc(s.kind)}</span> ` +
            `review by ${esc(s.reviewBy)} <span class="warn">${esc(s.daysOverdue)}d overdue</span></li>`,
        )
        .join("")
    : `<li class="ok">Nothing overdue for review.</li>`;

  const latency =
    d.latency.measured > 0
      ? `<p>Across <strong>${esc(d.latency.measured)}</strong> of ${esc(d.latency.verifiedCount)} verified records, ` +
        `approval took a median of <strong>${esc(d.latency.medianDays ?? 0)}</strong> and an average of ` +
        `<strong>${esc(d.latency.avgDays ?? 0)}</strong> days (added to verified, from git).</p>` +
        (d.latency.slowest.length
          ? `<ul class="plain">${d.latency.slowest
              .map((s) => `<li><code>${esc(s.id)}</code> ${esc(s.days)}d</li>`)
              .join("")}</ul>`
          : "")
      : `<p class="muted">No verified records with a git-provable approval yet.</p>`;

  const people = (title: string, rows: { name: string; count: number }[]): string =>
    `<h3>${esc(title)}</h3>` +
    (rows.length
      ? `<ul class="plain">${rows
          .slice(0, 8)
          .map((r) => `<li><span class="k">${esc(r.name)}</span> <span class="v">${esc(r.count)}</span></li>`)
          .join("")}</ul>`
      : `<p class="muted">none</p>`);

  const notTracked = d.notTracked.map((n) => `<li>${esc(n)}</li>`).join("");
  const generated = esc(d.generatedAt.replace("T", " ").replace(/\.\d+Z$/, " UTC"));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cohort vault health</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0b1222; color: #e2e8f0;
    font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  .wrap { max-width: 820px; margin: 0 auto; padding: 32px 16px 64px; }
  h1 { font-size: 24px; margin: 0 0 4px; letter-spacing: -0.3px; }
  h2 { font-size: 15px; text-transform: uppercase; letter-spacing: 1px; color: #94a3b8;
    margin: 32px 0 12px; }
  h3 { font-size: 14px; color: #cbd5e1; margin: 16px 0 8px; }
  .sub { color: #94a3b8; margin: 0 0 24px; font-size: 13px; }
  .cards { display: flex; gap: 12px; flex-wrap: wrap; }
  .card { flex: 1 1 140px; background: #111a30; border: 1px solid #1e293b;
    border-radius: 12px; padding: 16px; }
  .card .n { font-size: 28px; font-weight: 700; color: #f8fafc; }
  .card .l { color: #94a3b8; font-size: 13px; }
  .panel { background: #111a30; border: 1px solid #1e293b; border-radius: 12px; padding: 16px; }
  .row { display: flex; align-items: center; gap: 12px; margin: 8px 0; }
  .row .k { width: 110px; color: #cbd5e1; }
  .row .track { flex: 1; height: 10px; background: #1e293b; border-radius: 6px; overflow: hidden; }
  .row .fill { display: block; height: 100%; border-radius: 6px; }
  .row .v { width: 40px; text-align: right; color: #e2e8f0; font-variant-numeric: tabular-nums; }
  ul { margin: 0; padding: 0; list-style: none; }
  ul.list li { padding: 10px 0; border-bottom: 1px solid #1e293b; }
  ul.list li:last-child { border-bottom: 0; }
  ul.plain li { display: flex; justify-content: space-between; padding: 4px 0; max-width: 320px; }
  code { background: #0b1222; border: 1px solid #1e293b; border-radius: 6px; padding: 1px 6px;
    font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; color: #a5b4fc; }
  .muted { color: #94a3b8; font-size: 13px; }
  .snip { color: #cbd5e1; font-size: 13px; margin-top: 4px; padding-left: 10px;
    border-left: 2px solid #334155; }
  .ok { color: #86efac; }
  .warn { color: #fbbf24; }
  .cols { display: flex; gap: 24px; flex-wrap: wrap; }
  .cols > div { flex: 1 1 220px; }
  footer { margin-top: 40px; color: #64748b; font-size: 12px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Cohort vault health</h1>
  <p class="sub">${esc(d.vaultPath)} · generated ${generated} · local only, no data left this machine</p>

  <div class="cards">
    <div class="card"><div class="n">${esc(t.total)}</div><div class="l">records</div></div>
    <div class="card"><div class="n">${esc(t.byStatus.verified)}</div><div class="l">verified</div></div>
    <div class="card"><div class="n">${esc(d.stale.length)}</div><div class="l">overdue</div></div>
    <div class="card"><div class="n">${esc(d.contradictions.length)}</div><div class="l">contradictions</div></div>
  </div>

  <h2>Coverage</h2>
  <div class="cols">
    <div class="panel">${coverage}</div>
    <div class="panel">${statuses}</div>
  </div>

  <h2>Contradictions among verified facts</h2>
  <div class="panel"><ul class="list">${contradictions}</ul></div>

  <h2>Overdue for review</h2>
  <div class="panel"><ul class="list">${stale}</ul></div>

  <h2>Approval latency</h2>
  <div class="panel">${latency}</div>

  <h2>Who proposes, who approves</h2>
  <div class="panel cols">
    <div>${people("Proposers (by agent)", d.people.proposers)}</div>
    <div>${people("Approvers", d.people.approvers)}</div>
  </div>
  <p class="muted" style="margin-top:8px">${esc(d.writebacks.recordCommits)} writeback commit(s) by ${esc(d.writebacks.contributors)} contributor(s).</p>

  <h2>Not tracked</h2>
  <div class="panel">
    <p class="muted">Cohort keeps no telemetry. These would need runtime tracking, so they are left out rather than fabricated:</p>
    <ul class="list">${notTracked}</ul>
  </div>

  <footer>Generated by cohort report. Open from disk; this page makes no network request.</footer>
</div>
</body>
</html>
`;
}
