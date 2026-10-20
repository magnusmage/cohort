import { readVaultFile } from "./git.js";
import { type VaultRecord, parseRecord } from "./record.js";

/**
 * Deterministic merge and conflict surfacing for concurrent writebacks.
 *
 * Records are content-addressed: a record's id is a hash of its kind and
 * normalized text, and its file is named for that id. Two agents writing the
 * same fact therefore target the same path with identical content, which git
 * merges without conflict; two agents writing different facts target different
 * paths and never collide. That is the determinism and the dedup.
 *
 * The one case that must never be resolved by overwriting is a path that is
 * already occupied: re-proposing a fact a human has already verified would, if
 * the gate wrote blindly, replace the verified record with a fresh quarantined
 * one and silently drop the human's verification. So before any write the gate
 * classifies the target:
 *
 *  - absent     nothing there; write normally
 *  - duplicate  the same id is already present; keep what is there, skip the
 *               write (dedup), and report the existing record's status
 *  - conflict   a different or unparseable record occupies the path; surface it
 *               for a human and never overwrite
 */

export type MergeClassification =
  | { kind: "absent" }
  | { kind: "duplicate"; existingStatus: string }
  | { kind: "conflict"; reason: string };

/** Classify an incoming record against whatever already lives at its target path. */
export async function classifyAgainstExisting(
  root: string,
  relPath: string,
  incoming: VaultRecord,
): Promise<MergeClassification> {
  let raw: string;
  try {
    raw = await readVaultFile(root, relPath);
  } catch {
    return { kind: "absent" };
  }
  let existing: VaultRecord;
  try {
    existing = parseRecord(raw);
  } catch {
    return { kind: "conflict", reason: "an unparseable file occupies this path; resolve it by hand" };
  }
  if (existing.meta.id !== incoming.meta.id) {
    return { kind: "conflict", reason: `a different record (${existing.meta.id}) occupies this path` };
  }
  // Same id means the same normalized text. The existing record wins, so the
  // incoming one is a duplicate and its verification status (if any) is kept.
  return { kind: "duplicate", existingStatus: existing.meta.status };
}
