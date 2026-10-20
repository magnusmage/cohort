import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

/**
 * The audit model: a read-only view of a Cohort vault for the review and audit
 * dashboard.
 *
 * Everything here reads. It runs git and reads committed record files; it never
 * writes to the vault, and it holds no state of its own, so the dashboard can
 * never become the only copy of the memory. The vault in the team's git remains
 * the single source of truth; this is a lens over it.
 *
 * The control plane reads the open-core artifacts (the vault's records and git
 * history); the open-core packages never depend on the control plane. This
 * module deliberately parses only the few frontmatter fields the audit view
 * needs, rather than importing the server, so the two stay independently
 * buildable across the open-core boundary.
 */

const RECORD_DIRS = ["facts", "decisions", "threads"];
const KINDS = new Set(["fact", "decision", "thread"]);
const STATUSES = new Set(["proposed", "quarantined", "verified", "superseded"]);
const US = "\u001f";

function git(args: string[]): Promise<string> {
  return new Promise((res, rej) => {
    execFile("git", args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) rej(new Error(String(stderr).trim() || err.message));
      else res(String(stdout).trim());
    });
  });
}

export interface RecordSummary {
  id: string;
  kind: string;
  status: string;
  added: string | null;
  verified_by: string | null;
  path: string;
}

export interface WritebackCommit {
  commit: string;
  author: string;
  date: string;
  subject: string;
}

export interface AuditModel {
  generatedAt: string;
  source: "git";
  counts: {
    byKind: Record<string, number>;
    byStatus: Record<string, number>;
    unreadable: number;
  };
  records: RecordSummary[];
  writebacks: { commits: number; contributors: number; recent: WritebackCommit[] };
  note: string;
}

/** Read a flat top-level scalar field from a record's frontmatter. Returns null for a missing field or an explicit null. */
function field(frontmatter: string, key: string): string | null {
  const re = new RegExp(`^${key}:\\s*(.*)$`, "m");
  const m = re.exec(frontmatter);
  if (!m) return null;
  const value = (m[1] ?? "").trim();
  return value === "" || value === "null" ? null : value;
}

function summarize(text: string, path: string): RecordSummary | null {
  if (!text.startsWith("---\n")) return null;
  const close = text.indexOf("\n---\n", 4);
  if (close === -1) return null;
  const frontmatter = text.slice(4, close);
  const id = field(frontmatter, "id");
  const kind = field(frontmatter, "kind");
  const status = field(frontmatter, "status");
  if (!id || !kind || !status || !KINDS.has(kind) || !STATUSES.has(status)) return null;
  return { id, kind, status, added: field(frontmatter, "added"), verified_by: field(frontmatter, "verified_by"), path };
}

async function listRecordFiles(root: string): Promise<string[]> {
  const out = await git(["-C", root, "ls-files", "--", "."]);
  const files = out ? out.split("\n").filter(Boolean) : [];
  return files.filter((f) => f.endsWith(".md") && RECORD_DIRS.some((d) => f.startsWith(`${d}/`)));
}

/** Read a vault file, refusing a path that escapes the root. */
async function readWithin(root: string, relPath: string): Promise<string> {
  const abs = resolve(root, relPath);
  const rel = relative(root, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`path escapes the vault: ${relPath}`);
  return readFile(abs, "utf8");
}

async function writebacks(root: string): Promise<AuditModel["writebacks"]> {
  let lines: string[];
  try {
    const out = await git(["-C", root, "log", `--format=%H${US}%an${US}%aI${US}%s`, "--", ...RECORD_DIRS]);
    lines = out ? out.split("\n").filter(Boolean) : [];
  } catch {
    return { commits: 0, contributors: 0, recent: [] };
  }
  const authors = new Set<string>();
  const recent: WritebackCommit[] = [];
  for (const line of lines) {
    const [commit = "", author = "", date = "", subject = ""] = line.split(US);
    authors.add(author);
    if (recent.length < 20) recent.push({ commit, author, date, subject });
  }
  return { commits: lines.length, contributors: authors.size, recent };
}

/** Build the read-only audit model for a vault. */
export async function buildAudit(root: string): Promise<AuditModel> {
  const byKind: Record<string, number> = { fact: 0, decision: 0, thread: 0 };
  const byStatus: Record<string, number> = { proposed: 0, quarantined: 0, verified: 0, superseded: 0 };
  let unreadable = 0;
  const records: RecordSummary[] = [];

  for (const path of await listRecordFiles(root)) {
    let text: string;
    try {
      text = await readWithin(root, path);
    } catch {
      unreadable += 1;
      continue;
    }
    const summary = summarize(text, path);
    if (!summary) {
      unreadable += 1;
      continue;
    }
    byKind[summary.kind] = (byKind[summary.kind] ?? 0) + 1;
    byStatus[summary.status] = (byStatus[summary.status] ?? 0) + 1;
    records.push(summary);
  }
  records.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    generatedAt: new Date().toISOString(),
    source: "git",
    counts: { byKind, byStatus, unreadable },
    records,
    writebacks: await writebacks(root),
    note: "read-only view; the vault in git remains the source of truth and this dashboard never holds the only copy",
  };
}
