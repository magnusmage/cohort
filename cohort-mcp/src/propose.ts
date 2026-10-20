import { join } from "node:path";

import { type PrOpener, ghPrOpener } from "./git.js";
import { type GateDecision, runGate } from "./gate.js";
import { type LoadedPolicy, loadPolicy } from "./policy.js";
import { type Kind, createRecord } from "./record.js";
import { type SecretScanner, makeGitleaksScanner } from "./scan.js";

/**
 * cohort_propose: turn proposed items into records and run each through the
 * write gate.
 *
 * Provenance is stamped by the server from the established identity, not taken
 * from the model. Each item returns one decision: landed (with a commit or PR),
 * pending (a handle a human approves out of band), or rejected (a hard reason).
 * There is no path here that approves a pending handle; approval is out of band.
 */

const DIR_FOR: Record<Kind, string> = { fact: "facts", decision: "decisions", thread: "threads" };

export interface ProposeItem {
  kind: Kind;
  text: string;
  class?: string;
}

export interface ProposeItemResult {
  index: number;
  kind: Kind;
  id: string;
  decision: "landed" | "pending" | "rejected";
  mode?: "direct_commit" | "pull_request";
  commit?: string;
  branch?: string;
  prUrl?: string;
  handle?: string;
  reason?: string;
}

export interface ProposeDeps {
  scanner: SecretScanner;
  prOpener?: PrOpener;
  model?: string;
}

function mapDecision(index: number, kind: Kind, id: string, d: GateDecision): ProposeItemResult {
  if (d.decision === "landed") {
    const r: ProposeItemResult = { index, kind, id, decision: "landed", mode: d.mode, commit: d.commit, branch: d.branch };
    if (d.prUrl !== undefined) r.prUrl = d.prUrl;
    return r;
  }
  if (d.decision === "pending") {
    return { index, kind, id, decision: "pending", handle: d.handle, reason: d.reason };
  }
  return { index, kind, id, decision: "rejected", reason: d.reason };
}

/** Build records with server-stamped provenance and run each through the gate. */
export async function runProposals(
  root: string,
  loaded: LoadedPolicy,
  agentId: string | null,
  items: ProposeItem[],
  deps: ProposeDeps,
): Promise<ProposeItemResult[]> {
  const source = { agent: agentId ?? "unknown", model: deps.model ?? "unknown", commit: null };
  const results: ProposeItemResult[] = [];
  for (const [index, item] of items.entries()) {
    let record;
    try {
      record = createRecord({ kind: item.kind, text: item.text, source });
    } catch (err) {
      results.push({
        index,
        kind: item.kind,
        id: "",
        decision: "rejected",
        reason: `invalid record: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }
    const targetPath = `${DIR_FOR[item.kind]}/${record.meta.id}.md`;
    const gateDeps = {
      scanner: deps.scanner,
      ...(deps.prOpener ? { prOpener: deps.prOpener } : {}),
    };
    const decision = await runGate(root, loaded, agentId, { record, targetPath, declaredClass: item.class }, gateDeps);
    results.push(mapDecision(index, item.kind, record.meta.id, decision));
  }
  return results;
}

/** Default runner for the running server: resolve the vault, identity, rules, and PR opener from the environment. */
export async function defaultPropose(
  env: Record<string, string | undefined>,
  cwd: string,
  items: ProposeItem[],
): Promise<ProposeItemResult[]> {
  const root = env.COHORT_VAULT_DIR ?? cwd;
  const agentId = env.COHORT_AGENT_ID ?? null;
  const loaded = await loadPolicy(root);
  const scanner = makeGitleaksScanner(join(root, "security", "redaction-rules.toml"));
  const deps: ProposeDeps = { scanner, prOpener: ghPrOpener };
  if (env.COHORT_AGENT_MODEL !== undefined) deps.model = env.COHORT_AGENT_MODEL;
  return runProposals(root, loaded, agentId, items, deps);
}
