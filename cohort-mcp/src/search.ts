import { matchesAny } from "./gate.js";
import { listTracked, readVaultFile } from "./git.js";
import { type LoadedPolicy, loadPolicy } from "./policy.js";
import { parseRecord } from "./record.js";

/**
 * cohort_search: a bounded lookup across the vault.
 *
 * It honors paths.readable and paths.deny exactly like cohort_load, and it is
 * trust-forward: by default it returns only verified records, and the caller
 * opts into quarantined (agent-asserted) results with include_quarantined.
 * Superseded records are never returned. Plain substring match for now;
 * semantic retrieval is Phase 5.
 */

const RECORD_DIRS = ["facts", "decisions", "threads"];
const HIT_LIMIT = 50;

export interface SearchHit {
  id: string;
  kind: string;
  status: string;
  snippet: string;
}

export interface SearchResult {
  query: string;
  count: number;
  includeQuarantined: boolean;
  hits: SearchHit[];
}

export interface SearchOptions {
  query: string;
  includeQuarantined?: boolean;
}

function snippet(text: string): string {
  const firstLine = text.split("\n", 1)[0] ?? "";
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine;
}

export async function searchVault(
  root: string,
  loaded: LoadedPolicy,
  _agentId: string | null,
  opts: SearchOptions,
): Promise<SearchResult> {
  const { policy } = loaded;
  const includeQuarantined = opts.includeQuarantined ?? false;
  const needle = opts.query.trim().toLowerCase();

  const tracked = await listTracked(root, ".");
  const files = tracked.filter((f) => f.endsWith(".md") && RECORD_DIRS.some((d) => f.startsWith(`${d}/`)));

  const hits: SearchHit[] = [];
  for (const f of files) {
    if (policy.paths.readable.length > 0 && !matchesAny(policy.paths.readable, f)) continue;
    if (matchesAny(policy.paths.deny, f)) continue;
    let record;
    try {
      record = parseRecord(await readVaultFile(root, f));
    } catch {
      continue;
    }
    if (record.meta.status === "superseded") continue;
    if (record.meta.status === "quarantined" && !includeQuarantined) continue;
    const haystack = `${record.text}\n${record.meta.kind}`.toLowerCase();
    if (needle.length > 0 && !haystack.includes(needle)) continue;
    if (hits.length < HIT_LIMIT) {
      hits.push({ id: record.meta.id, kind: record.meta.kind, status: record.meta.status, snippet: snippet(record.text) });
    }
  }

  return { query: opts.query, count: hits.length, includeQuarantined, hits };
}

/** Default provider for the running server: read the vault and identity from the environment. */
export async function defaultSearch(
  env: Record<string, string | undefined>,
  cwd: string,
  opts: SearchOptions,
): Promise<SearchResult> {
  const root = env.COHORT_VAULT_DIR ?? cwd;
  const agentId = env.COHORT_AGENT_ID ?? null;
  const loaded = await loadPolicy(root);
  return searchVault(root, loaded, agentId, opts);
}
