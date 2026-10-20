import { git, readVaultFile } from "./git.js";
import { loadPolicy } from "./policy.js";
import { parseRecord } from "./record.js";
import { findRecordPath } from "./verify.js";

/**
 * cohort_why: provenance forensics for one record, read from git.
 *
 * It answers who, which model, when, and why a record exists. Two sources are
 * reported side by side: what the writer claimed in the record's frontmatter
 * (agent, model, source commit), and what git history records about the file
 * (the authoritative author and dates). Git is the trustworthy account: the
 * frontmatter is self-asserted and can be wrong, so the two are kept distinct
 * rather than merged. This is read-only: it runs git log and reads the record,
 * and makes no network call and no write.
 */

const US = "\u001f"; // unit separator, safe field delimiter for git format

export interface Commit {
  commit: string;
  author: string;
  date: string;
  subject: string;
}

export interface WhyResult {
  found: boolean;
  id: string;
  path?: string;
  kind?: string;
  status?: string;
  /** What the writer asserted in the record's frontmatter. Self-reported, not authoritative. */
  claimed?: {
    agent: string;
    model: string;
    commit: string | null;
    added: string;
    verified_by: string | null;
    supersedes: string | null;
  };
  /** What git history records about the file. Authoritative. */
  history?: {
    firstSeen: Commit | null;
    lastChanged: Commit | null;
    commitCount: number;
  };
  /** The record's first line, as a short, data-only preview. Full content is via cohort_load. */
  preview?: string;
  note?: string;
}

function preview(text: string): string {
  const firstLine = text.split("\n", 1)[0] ?? "";
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine;
}

async function fileHistory(root: string, path: string): Promise<Commit[]> {
  let out: string;
  try {
    out = await git(["-C", root, "log", "--follow", `--format=%H${US}%an${US}%aI${US}%s`, "--", path]);
  } catch {
    return [];
  }
  if (!out) return [];
  return out.split("\n").map((line) => {
    const [commit = "", author = "", date = "", subject = ""] = line.split(US);
    return { commit, author, date, subject };
  });
}

/** Explain one record's provenance from git history and its frontmatter. */
export async function explainRecord(root: string, id: string): Promise<WhyResult> {
  const path = await findRecordPath(root, id);
  if (!path) return { found: false, id, note: "no record with that id is tracked in the vault" };

  const record = parseRecord(await readVaultFile(root, path));
  const commits = await fileHistory(root, path);
  const firstSeen = commits.length > 0 ? (commits[commits.length - 1] ?? null) : null;
  const lastChanged = commits.length > 0 ? (commits[0] ?? null) : null;

  return {
    found: true,
    id,
    path,
    kind: record.meta.kind,
    status: record.meta.status,
    claimed: {
      agent: record.meta.source.agent,
      model: record.meta.source.model,
      commit: record.meta.source.commit,
      added: record.meta.added,
      verified_by: record.meta.verified_by,
      supersedes: record.meta.supersedes,
    },
    history: { firstSeen, lastChanged, commitCount: commits.length },
    preview: preview(record.text),
    note: commits.length === 0 ? "the record is not yet committed, so git history is empty" : undefined,
  };
}

/** Default provider for the running server: resolve the vault from the environment. */
export async function defaultWhy(
  env: Record<string, string | undefined>,
  cwd: string,
  id: string,
): Promise<WhyResult> {
  const root = env.COHORT_VAULT_DIR ?? cwd;
  await loadPolicy(root); // keep resolution consistent with the other providers
  return explainRecord(root, id);
}
