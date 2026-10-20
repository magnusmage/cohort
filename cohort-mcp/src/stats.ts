import { git, listTracked, readVaultFile } from "./git.js";
import { loadContext } from "./load.js";
import { type LoadedPolicy, loadPolicy } from "./policy.js";
import { parseRecord } from "./record.js";

/**
 * cohort stats: the "does this save time?" evidence, computed honestly.
 *
 * Cohort keeps no telemetry, so anything that would need runtime tracking
 * (writebacks rejected, re-explanations avoided, tokens per load over time) is
 * not tracked rather than fabricated. What is reported is derived from the
 * vault and git: record counts by kind and status, the number of writeback
 * commits and distinct contributors, and the current load size as an estimate.
 */

const RECORD_DIRS = ["facts", "decisions", "threads"];

export interface StatsView {
  records: {
    total: number;
    byKind: Record<"fact" | "decision" | "thread", number>;
    byStatus: Record<"proposed" | "quarantined" | "verified" | "superseded", number>;
  };
  writebacks: { recordCommits: number; contributors: number };
  currentLoad: { approxTokens: number };
  notTracked: string[];
  note: string;
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

export async function computeStats(root: string, loaded: LoadedPolicy, agentId: string | null): Promise<StatsView> {
  const byKind = { fact: 0, decision: 0, thread: 0 };
  const byStatus = { proposed: 0, quarantined: 0, verified: 0, superseded: 0 };
  let total = 0;

  const tracked = await listTracked(root, ".");
  const files = tracked.filter((f) => f.endsWith(".md") && RECORD_DIRS.some((d) => f.startsWith(`${d}/`)));
  for (const f of files) {
    try {
      const record = parseRecord(await readVaultFile(root, f));
      byKind[record.meta.kind] += 1;
      byStatus[record.meta.status] += 1;
      total += 1;
    } catch {
      // skip unreadable
    }
  }

  const writebacks = await writebackHistory(root);
  const context = await loadContext(root, loaded, agentId);
  const loadSize = Math.round(context.text.length / 4);

  return {
    records: { total, byKind, byStatus },
    writebacks,
    currentLoad: { approxTokens: loadSize },
    notTracked: ["writebacks rejected", "re-explanations avoided", "tokens per load over time"],
    note: "Cohort keeps no telemetry; the not-tracked figures would require runtime tracking and are omitted by design.",
  };
}

/** Default provider for the running server or CLI: read the vault and identity from the environment. */
export async function defaultStats(env: Record<string, string | undefined>, cwd: string): Promise<StatsView> {
  const root = env.COHORT_VAULT_DIR ?? cwd;
  const agentId = env.COHORT_AGENT_ID ?? null;
  const loaded = await loadPolicy(root);
  return computeStats(root, loaded, agentId);
}
