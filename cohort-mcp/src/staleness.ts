import { type VaultRecord } from "./record.js";

/**
 * Staleness, supersession, and decay.
 *
 * Three related ideas, all of which surface state rather than destroy it:
 *
 *  - Supersession: a verified record can declare that it replaces an older one.
 *    The older record then drops out of load, but its file stays in git, so the
 *    history is never lost. Only a verified record's supersedes claim is
 *    honored, so a low-trust record cannot hide a verified one from load.
 *  - Staleness: a record past its review_by horizon is overdue for review. It
 *    is not removed or trusted less automatically; it is flagged so a human
 *    knows to look again.
 *  - Decay: within a trust tier, a stale record ranks below a fresh one, so a
 *    bounded load spends its budget on current memory first.
 */

/** Today's date as YYYY-MM-DD. Split out so callers can pass a fixed day in tests. */
export function todayStr(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** A record is stale when it has a review_by horizon that has already passed. */
export function isStale(meta: { review_by: string | null }, today: string = todayStr()): boolean {
  return meta.review_by !== null && meta.review_by < today;
}

/**
 * The ids superseded by a verified record. Only verified records are trusted to
 * supersede, so an agent-asserted or quarantined record cannot drop a verified
 * record from load by claiming to replace it.
 */
export function supersededByVerified(records: VaultRecord[]): Set<string> {
  const superseded = new Set<string>();
  for (const r of records) {
    if (r.meta.status === "verified" && r.meta.supersedes) superseded.add(r.meta.supersedes);
  }
  return superseded;
}
