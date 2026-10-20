import { listTracked, readVaultFile } from "./git.js";
import { type EffectivePolicy, type LoadedPolicy, loadPolicy, resolveEffective } from "./policy.js";
import { parseRecord } from "./record.js";

/**
 * cohort_status: a read-only snapshot of the vault and policy state.
 *
 * Counts are computed from the actual records on disk, never fabricated. An
 * unreadable or malformed record is counted separately rather than guessed.
 * Pending proposals are not persisted server-side in Phase 1 (approval is out
 * of band), so they are reported as untracked rather than invented. The
 * quarantine count is real and seams into the Phase 2 quarantine queue.
 */

const RECORD_DIRS = ["facts", "decisions", "threads"];

export interface StatusView {
  agent: string | null;
  degraded: boolean;
  reason?: string;
  defaults: EffectivePolicy;
  effective: EffectivePolicy;
  counts: {
    byKind: Record<"fact" | "decision" | "thread", number>;
    byStatus: Record<"proposed" | "quarantined" | "verified" | "superseded", number>;
    unreadable: number;
  };
  pending: { tracked: boolean; items: string[] };
  quarantine: { count: number; items: Array<{ id: string; kind: string; preview: string }>; note: string };
}

const QUEUE_LIMIT = 50;

function preview(text: string): string {
  const firstLine = text.split("\n", 1)[0] ?? "";
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}

export async function buildStatus(root: string, loaded: LoadedPolicy, agentId: string | null): Promise<StatusView> {
  const { policy } = loaded;
  const byKind = { fact: 0, decision: 0, thread: 0 };
  const byStatus = { proposed: 0, quarantined: 0, verified: 0, superseded: 0 };
  let unreadable = 0;
  const queue: Array<{ id: string; kind: string; preview: string }> = [];

  const tracked = await listTracked(root, ".");
  const files = tracked.filter((f) => f.endsWith(".md") && RECORD_DIRS.some((d) => f.startsWith(`${d}/`)));
  for (const f of files) {
    try {
      const record = parseRecord(await readVaultFile(root, f));
      byKind[record.meta.kind] += 1;
      byStatus[record.meta.status] += 1;
      if (record.meta.status === "quarantined" && queue.length < QUEUE_LIMIT) {
        queue.push({ id: record.meta.id, kind: record.meta.kind, preview: preview(record.text) });
      }
    } catch {
      unreadable += 1;
    }
  }

  const view: StatusView = {
    agent: agentId,
    degraded: loaded.degraded,
    defaults: policy.defaults,
    effective: resolveEffective(policy, { agentId }),
    counts: { byKind, byStatus, unreadable },
    pending: { tracked: false, items: [] },
    quarantine: {
      count: byStatus.quarantined,
      items: queue,
      note: "these records await human verification; promote them with cohort verify",
    },
  };
  if (loaded.reason !== undefined) view.reason = loaded.reason;
  return view;
}

/** Default provider for the running server: read the vault and identity from the environment. */
export async function defaultStatus(env: Record<string, string | undefined>, cwd: string): Promise<StatusView> {
  const root = env.COHORT_VAULT_DIR ?? cwd;
  const agentId = env.COHORT_AGENT_ID ?? null;
  const loaded = await loadPolicy(root);
  return buildStatus(root, loaded, agentId);
}
