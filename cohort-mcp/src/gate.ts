import { randomBytes } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import picomatch from "picomatch";

import { type Contradiction, detectContradiction } from "./contradiction.js";
import { type PrOpener, landWrite } from "./git.js";
import { lintForInjection } from "./lint.js";
import { HARD_NEVER_CLASSES, type LoadedPolicy, resolveEffective } from "./policy.js";
import { type VaultRecord, serializeRecord } from "./record.js";
import type { SecretScanner } from "./scan.js";

/**
 * The write gate. Every proposed write passes through here before anything
 * lands. The order is deliberate and fail-closed:
 *
 *   1. deny-check    canonicalize the path, reject escapes, .cohort, denied
 *                    globs, and anything outside the writable scope
 *   2. never-class   the secret and PII classes are hard-denied
 *   3. secret-scan   scan the content; a missing scanner or any finding rejects
 *   4. instruction-lint  flagged content can never auto-land
 *   4b. contradiction  a fact that negates a verified fact can never auto-land
 *   5. classify      the declared class is a hint, never an authorization
 *   6. decide        resolve the effective policy for the server-set identity
 *   7. land          auto commits or opens a PR; ask returns a pending handle;
 *                    never rejects
 *
 * A hard rejection (steps 1 to 3) returns no handle, so no approval can land
 * it. The model cannot approve its own pending handle; approval is out of band.
 */

export class GateReject extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GateReject";
  }
}

export interface Proposal {
  record: VaultRecord;
  targetPath: string;
  declaredClass?: string;
}

export interface GateDeps {
  scanner: SecretScanner;
  prOpener?: PrOpener;
  linter?: (content: string) => { flagged: boolean; reasons: string[] };
  /** Supplies the verified facts to check a proposed fact against. When absent, the check is skipped. */
  verifiedFacts?: () => Promise<VaultRecord[]>;
}

export type GateDecision =
  | { decision: "rejected"; reason: string }
  | { decision: "landed"; mode: "direct_commit" | "pull_request"; commit: string; branch: string; prUrl?: string }
  | { decision: "pending"; handle: string; reason: string };

export function matchesAny(globs: string[], relPath: string): boolean {
  if (globs.length === 0) return false;
  return picomatch(globs, { dot: true })(relPath);
}

/** Resolve a target path strictly inside the vault, defending against traversal and symlink escapes. */
export async function canonicalizeWithinVault(root: string, relPath: string): Promise<string> {
  const realRoot = await realpath(root);
  const abs = resolve(realRoot, relPath);
  const rel = relative(realRoot, abs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new GateReject(`path escapes the vault: ${relPath}`);
  }
  if (rel === ".cohort" || rel.startsWith(`.cohort${sep}`)) {
    throw new GateReject(".cohort is not writable by the model");
  }
  // Walk up to the deepest existing ancestor and make sure its real path
  // still lives inside the vault, so a symlink cannot redirect the write out.
  let ancestor = dirname(abs);
  for (;;) {
    let real: string | null;
    try {
      real = await realpath(ancestor);
    } catch {
      real = null;
    }
    if (real !== null) {
      const relReal = relative(realRoot, real);
      if (relReal.startsWith("..") || isAbsolute(relReal)) {
        throw new GateReject("path escapes the vault through a symlink");
      }
      break;
    }
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  return rel.split(sep).join("/");
}

function reject(reason: string): GateDecision {
  return { decision: "rejected", reason };
}

export async function runGate(
  root: string,
  loaded: LoadedPolicy,
  agentId: string | null,
  proposal: Proposal,
  deps: GateDeps,
): Promise<GateDecision> {
  const { policy } = loaded;

  // 1. deny-check.
  let rel: string;
  try {
    rel = await canonicalizeWithinVault(root, proposal.targetPath);
  } catch (err) {
    return reject(err instanceof GateReject ? err.message : `invalid path: ${String(err)}`);
  }
  if (matchesAny(policy.paths.deny, rel)) return reject(`path is denied by policy: ${rel}`);
  if (!matchesAny(policy.paths.writable, rel)) return reject(`path is outside the writable scope: ${rel}`);

  // 2. hard never-class.
  if (proposal.declaredClass && (HARD_NEVER_CLASSES as readonly string[]).includes(proposal.declaredClass)) {
    return reject(`class ${proposal.declaredClass} is hard-denied and cannot be written`);
  }

  // 3. secret and PII scan. A missing scanner or any finding is a hard refusal.
  const serialized = serializeRecord(proposal.record);
  let scan;
  try {
    scan = await deps.scanner.scan(serialized);
  } catch (err) {
    return reject(`secret scan unavailable; refusing to write (fail closed): ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!scan.clean) return reject(`secret or PII detected: ${scan.findings.join(", ")}`);

  // 4. instruction-lint.
  const lint = (deps.linter ?? lintForInjection)(serialized);

  // 4b. contradiction check. A proposed fact that negates a verified fact on the
  // same topic is never auto-landed, so a poisoned fact cannot quietly override
  // verified memory. It is surfaced for a human, not resolved here.
  let contradiction: Contradiction = { conflict: false };
  if (proposal.record.meta.kind === "fact" && deps.verifiedFacts) {
    contradiction = detectContradiction(proposal.record, await deps.verifiedFacts());
  }

  // 5 and 6. classify (declared class is a hint) and decide.
  const className = proposal.declaredClass;
  const effective = resolveEffective(policy, { className, agentId });
  let propose = effective.propose;
  if (!className && propose === "auto") propose = "ask"; // no class is ambiguous: never auto
  if (lint.flagged && propose === "auto") propose = "ask"; // injection shape: never auto
  if (contradiction.conflict && propose === "auto") propose = "ask"; // contradiction: never auto

  // 7. land.
  if (propose === "never") return reject("policy forbids this write (never)");
  if (propose === "ask") {
    const handle = randomBytes(8).toString("hex");
    const flags: string[] = [];
    if (lint.flagged) flags.push(`flagged: ${lint.reasons.join(", ")}`);
    if (contradiction.conflict && contradiction.reason) flags.push(contradiction.reason);
    const reason = flags.length > 0 ? `held for human approval (${flags.join("; ")})` : "held for human approval";
    return { decision: "pending", handle, reason };
  }

  // auto: write the record and land it per on_write.
  const abs = resolve(await realpath(root), rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, serialized, "utf8");
  const result = await landWrite(
    root,
    {
      onWrite: effective.on_write,
      message: `memory: add ${proposal.record.meta.kind} ${proposal.record.meta.id}`,
      paths: [rel],
      label: proposal.record.meta.kind,
      title: `Add ${proposal.record.meta.kind} ${proposal.record.meta.id}`,
      body: "Proposed by Cohort. Review before landing.",
    },
    deps.prOpener ? { prOpener: deps.prOpener } : {},
  );
  const landed: GateDecision = {
    decision: "landed",
    mode: result.mode,
    commit: result.commit,
    branch: result.branch,
  };
  if (result.prUrl !== undefined) landed.prUrl = result.prUrl;
  return landed;
}
