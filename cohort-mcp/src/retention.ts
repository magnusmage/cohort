import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { git, listTracked } from "./git.js";
import { type Kind, parseRecord } from "./record.js";

/**
 * Retention and recovery.
 *
 * Cohort never hard-deletes a record: a superseded or removed record keeps its
 * full content in git history. Recovery restores such a record by id, read from
 * history, back into the working tree for a human to review and commit. The
 * retention policy states the window within which recovery is guaranteed; it is
 * advisory and reported, and nothing here rewrites or prunes git history, which
 * would be the only way to actually destroy a record and is deliberately out of
 * scope.
 */

const US = "\u001f";
const DIR_FOR: Record<Kind, string> = { fact: "facts", decision: "decisions", thread: "threads" };
const RECORD_DIRS = ["facts", "decisions", "threads"];

const retentionSchema = z.object({
  version: z.number().optional(),
  keep_days: z.number().int().positive().default(365),
});

export type RetentionConfig = z.infer<typeof retentionSchema>;
export const DEFAULT_RETENTION: RetentionConfig = { keep_days: 365 };

export function loadRetentionFromText(text: string): RetentionConfig {
  const parsed = retentionSchema.safeParse(parseYaml(text));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(`invalid retention config: ${first ? `${first.path.join(".") || "(root)"}: ${first.message}` : "unknown"}`);
  }
  return parsed.data;
}

/** The canonical path for a record id, derived from its kind prefix. */
export function pathForId(id: string): string | null {
  const prefix = id[0];
  const kind: Kind | null = prefix === "f" ? "fact" : prefix === "d" ? "decision" : prefix === "t" ? "thread" : null;
  return kind ? `${DIR_FOR[kind]}/${id}.md` : null;
}

async function commitsTouching(root: string, path: string): Promise<string[]> {
  try {
    const out = await git(["-C", root, "log", "--all", "--format=%H", "--", path]);
    return out ? out.split("\n").filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function showAt(root: string, commit: string, path: string): Promise<string | null> {
  try {
    return await git(["-C", root, "show", `${commit}:${path}`]);
  } catch {
    return null;
  }
}

/** The most recent commit at which the file still existed, with its content. */
async function lastExisting(root: string, path: string): Promise<{ commit: string; content: string } | null> {
  for (const commit of await commitsTouching(root, path)) {
    const content = await showAt(root, commit, path);
    if (content !== null) return { commit, content };
  }
  return null;
}

async function removalInfo(root: string, path: string): Promise<{ commit: string; date: string } | null> {
  try {
    const out = await git(["-C", root, "log", "-n", "1", "--all", "--diff-filter=D", `--format=%H${US}%aI`, "--", path]);
    if (!out) return null;
    const [commit = "", date = ""] = out.split(US);
    return { commit, date };
  } catch {
    return null;
  }
}

async function isTracked(root: string, path: string): Promise<boolean> {
  const tracked = await git(["-C", root, "ls-files", "--", path]);
  return tracked.trim().length > 0;
}

export interface RecoverResult {
  found: boolean;
  id: string;
  path?: string;
  tracked?: boolean;
  removedAt?: string;
  removedIn?: string;
  restored?: boolean;
  preview?: string;
  note?: string;
}

/** Recover a record by id from git history. With restore, write it back for a human to commit. */
export async function recoverRecord(root: string, id: string, opts: { restore?: boolean } = {}): Promise<RecoverResult> {
  const path = pathForId(id);
  if (!path) return { found: false, id, note: "id does not map to a record kind" };

  const last = await lastExisting(root, path);
  if (!last) return { found: false, id, path, note: "no version of this record exists in git history" };

  // Guard against a path that once held a different record.
  let preview = last.content.split("\n").find((l) => l && !l.startsWith("---")) ?? "";
  try {
    const record = parseRecord(last.content);
    if (record.meta.id !== id) {
      return { found: false, id, path, note: `history at this path holds a different record (${record.meta.id})` };
    }
    preview = record.text.split("\n", 1)[0] ?? "";
  } catch {
    // Keep the raw preview; the content is still recoverable even if it no longer parses.
  }
  if (preview.length > 120) preview = `${preview.slice(0, 117)}...`;

  const tracked = await isTracked(root, path);
  const removal = tracked ? null : await removalInfo(root, path);

  let restored = false;
  if (opts.restore && !tracked) {
    const abs = join(root, path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, last.content, "utf8");
    restored = true;
  }

  const result: RecoverResult = { found: true, id, path, tracked, preview };
  if (removal) {
    result.removedAt = removal.date;
    result.removedIn = removal.commit;
  }
  if (opts.restore) result.restored = restored;
  if (tracked) result.note = "the record is still tracked; nothing to recover";
  return result;
}

export interface RemovedRecord {
  id: string;
  path: string;
  removedAt: string;
  withinRetention: boolean;
}

/** True when a record removed at removedAt is still within the retention window. */
export function withinRetention(removedAt: string, keepDays: number, now: Date = new Date()): boolean {
  const removed = Date.parse(removedAt);
  if (Number.isNaN(removed)) return false;
  return removed + keepDays * 86400000 >= now.getTime();
}

/** List records removed from the working tree but still recoverable from history. */
export async function listRemoved(root: string, cfg: RetentionConfig = DEFAULT_RETENTION): Promise<RemovedRecord[]> {
  let deleted: string[];
  try {
    const out = await git(["-C", root, "log", "--all", "--diff-filter=D", "--name-only", "--format="]);
    deleted = out ? out.split("\n").filter((f) => f.endsWith(".md") && RECORD_DIRS.some((d) => f.startsWith(`${d}/`))) : [];
  } catch {
    return [];
  }
  const trackedSet = new Set(await listTracked(root, "."));
  const seen = new Set<string>();
  const removed: RemovedRecord[] = [];
  for (const path of deleted) {
    if (seen.has(path) || trackedSet.has(path)) continue;
    seen.add(path);
    const info = await removalInfo(root, path);
    if (!info) continue;
    const id = path.replace(/^.*\//, "").replace(/\.md$/, "");
    removed.push({ id, path, removedAt: info.date, withinRetention: withinRetention(info.date, cfg.keep_days) });
  }
  removed.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return removed;
}
