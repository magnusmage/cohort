import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { listTracked, readVaultFile } from "./git.js";
import { type RecordMeta, type VaultRecord, parseRecord, serializeRecord } from "./record.js";

/**
 * Git-native retrieval index.
 *
 * The index is a single committed JSON document under .cohort/index/, built
 * from the vault's records. It carries no timestamps, no machine paths beyond
 * the vault-relative record path, and no random data, so a rebuild on the same
 * committed vault produces byte-identical output. That is what makes it
 * diffable in a pull request: a reviewer sees exactly which records changed and
 * how, and the index can be regenerated and checked in CI.
 *
 * The index is a lean, derived view: record metadata plus a size estimate and a
 * content hash. It holds no record body, so committing the index never widens
 * what a reader can see beyond the records themselves, and the body still lives
 * only in its own file under facts/, decisions/, or threads/.
 */

const RECORD_DIRS = ["facts", "decisions", "threads"];

export const INDEX_VERSION = "1";
/** The committed index path, relative to the vault root. */
export const INDEX_PATH = ".cohort/index/records.json";

export interface IndexEntry {
  id: string;
  kind: RecordMeta["kind"];
  status: RecordMeta["status"];
  confidence: RecordMeta["confidence"];
  path: string;
  added: string;
  review_by: string | null;
  supersedes: string | null;
  verified_by: string | null;
  /** A rough token estimate for the record body, used to budget retrieval. */
  approxTokens: number;
  /** sha256 over the serialized record, so index drift from the vault is detectable. */
  contentHash: string;
}

export interface VaultIndex {
  version: string;
  records: IndexEntry[];
}

/** A rough token estimate: about four characters per token. Deterministic from content. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function hashRecord(record: VaultRecord): string {
  return createHash("sha256").update(serializeRecord(record)).digest("hex");
}

function entryFor(record: VaultRecord, path: string): IndexEntry {
  const m = record.meta;
  return {
    id: m.id,
    kind: m.kind,
    status: m.status,
    confidence: m.confidence,
    path,
    added: m.added,
    review_by: m.review_by,
    supersedes: m.supersedes,
    verified_by: m.verified_by,
    approxTokens: estimateTokens(record.text),
    contentHash: hashRecord(record),
  };
}

/** Build the index from the tracked record files. Deterministic: entries sorted by id. */
export async function buildIndex(root: string): Promise<VaultIndex> {
  const tracked = await listTracked(root, ".");
  const files = tracked.filter((f) => f.endsWith(".md") && RECORD_DIRS.some((d) => f.startsWith(`${d}/`)));
  const records: IndexEntry[] = [];
  for (const f of files) {
    try {
      records.push(entryFor(parseRecord(await readVaultFile(root, f)), f));
    } catch {
      // A malformed record is skipped here; the gate and verify surface it elsewhere.
    }
  }
  records.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { version: INDEX_VERSION, records };
}

/** Stable JSON with a trailing newline, so the committed file diffs cleanly. */
export function serializeIndex(index: VaultIndex): string {
  return `${JSON.stringify(index, null, 2)}\n`;
}

/** Parse and validate a committed index document. Fails closed on an unknown version. */
export function parseIndex(json: string): VaultIndex {
  const raw = JSON.parse(json) as { version?: unknown; records?: unknown };
  if (raw.version !== INDEX_VERSION) {
    throw new Error(`unsupported index version: ${String(raw.version)}`);
  }
  if (!Array.isArray(raw.records)) {
    throw new Error("index: records must be an array");
  }
  return { version: INDEX_VERSION, records: raw.records as IndexEntry[] };
}

/** Read the committed index, or null when it has not been generated yet. */
export async function readIndex(root: string): Promise<VaultIndex | null> {
  try {
    return parseIndex(await readVaultFile(root, INDEX_PATH));
  } catch {
    return null;
  }
}

/** Write the index to its committed path. Does not commit; the human reviews and commits. */
export async function writeIndex(root: string, index: VaultIndex): Promise<string> {
  const abs = join(root, INDEX_PATH);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, serializeIndex(index), "utf8");
  return INDEX_PATH;
}

export interface IndexStatus {
  inSync: boolean;
  committed: boolean;
  /** Record ids present in the vault but missing from the committed index. */
  missing: string[];
  /** Record ids present in the committed index but no longer in the vault. */
  stale: string[];
  /** Record ids whose content hash differs between the vault and the index. */
  changed: string[];
}

/** Compare the committed index against a fresh build, so CI can fail on drift. */
export async function indexStatus(root: string): Promise<IndexStatus> {
  const fresh = await buildIndex(root);
  const committed = await readIndex(root);
  if (!committed) {
    return { inSync: false, committed: false, missing: fresh.records.map((r) => r.id), stale: [], changed: [] };
  }
  const freshById = new Map(fresh.records.map((r) => [r.id, r] as const));
  const committedById = new Map(committed.records.map((r) => [r.id, r] as const));
  const missing: string[] = [];
  const changed: string[] = [];
  for (const [id, entry] of freshById) {
    const was = committedById.get(id);
    if (!was) missing.push(id);
    else if (was.contentHash !== entry.contentHash) changed.push(id);
  }
  const stale: string[] = [];
  for (const id of committedById.keys()) {
    if (!freshById.has(id)) stale.push(id);
  }
  missing.sort();
  stale.sort();
  changed.sort();
  return { inSync: missing.length === 0 && stale.length === 0 && changed.length === 0, committed: true, missing, stale, changed };
}
