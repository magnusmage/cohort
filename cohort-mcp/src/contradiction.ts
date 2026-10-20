import { listTracked, readVaultFile } from "./git.js";
import { type VaultRecord, parseRecord } from "./record.js";

/**
 * Contradiction detection for the write gate.
 *
 * The aim is narrow and defensive: catch a proposed fact that asserts the
 * opposite of a fact a human has already verified, on the same topic, so it is
 * held for a human instead of quietly landing and overriding verified memory.
 *
 * This is a deterministic heuristic, not natural-language understanding. It
 * compares the significant terms of two facts to decide whether they are about
 * the same thing, and it compares their polarity (does one negate what the
 * other asserts). A same-topic pair with opposite polarity is flagged. It is
 * tuned to stay quiet on unrelated or merely overlapping facts, because a false
 * flag only asks a human and a missed contradiction is the dangerous case. It
 * never auto-resolves a conflict; it only surfaces one.
 */

const RECORD_DIRS = ["facts", "decisions", "threads"];

// Words that carry no topic signal. Negation cues are tracked separately below.
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "for", "with", "our", "their", "its", "his", "her",
  "this", "that", "these", "those", "are", "was", "were", "been", "being", "has", "have", "had",
  "will", "would", "should", "could", "can", "may", "might", "must", "shall", "into", "onto",
  "from", "about", "over", "under", "than", "then", "when", "where", "which", "who", "whom",
  "what", "how", "why", "all", "any", "some", "each", "every", "use", "using", "used", "via",
  "per", "out", "off", "set", "get", "now", "new", "old", "one", "two", "also", "only", "both",
]);

// Negation cues. These flip the polarity of a statement; they are not topic terms.
const NEGATION =
  /(^|[^a-z])(no|not|never|cannot|none|neither|nor|avoid|without|deprecated|forbidden|disallowed?|removed?|dropped?|stopped?|discontinued?)([^a-z]|$)|n['’]t([^a-z]|$)/;

const NEGATION_WORDS = new Set([
  "no", "not", "never", "cannot", "none", "neither", "nor", "avoid", "without", "deprecated",
  "forbidden", "disallow", "disallowed", "remove", "removed", "drop", "dropped", "stop", "stopped",
  "discontinue", "discontinued",
]);

export interface Contradiction {
  conflict: boolean;
  withId?: string;
  reason?: string;
}

/** Does the text carry a negation cue? Deterministic, case-insensitive. */
export function hasNegation(text: string): boolean {
  return NEGATION.test(text.toLowerCase());
}

/** The topic-bearing terms of a fact: lowercased words of length >= 3, minus stopwords and negation cues. */
export function significantTerms(text: string): Set<string> {
  const terms = new Set<string>();
  for (const token of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (token.length < 3) continue;
    if (STOPWORDS.has(token) || NEGATION_WORDS.has(token)) continue;
    terms.add(token);
  }
  return terms;
}

function sameTopic(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  if (shared < 2) return false;
  const union = new Set([...a, ...b]).size;
  return shared / union >= 0.34;
}

/**
 * Compare one candidate fact against the verified facts. Returns the first
 * same-topic, opposite-polarity match. Only facts are compared; decisions and
 * threads are narrative and are left to human review.
 */
export function detectContradiction(candidate: VaultRecord, verified: VaultRecord[]): Contradiction {
  if (candidate.meta.kind !== "fact") return { conflict: false };
  const candTerms = significantTerms(candidate.text);
  const candNeg = hasNegation(candidate.text);
  for (const other of verified) {
    if (other.meta.kind !== "fact" || other.meta.status !== "verified") continue;
    if (other.meta.id === candidate.meta.id) continue;
    if (!sameTopic(candTerms, significantTerms(other.text))) continue;
    if (candNeg === hasNegation(other.text)) continue; // same polarity: not a contradiction
    return {
      conflict: true,
      withId: other.meta.id,
      reason: `contradicts verified fact ${other.meta.id} on the same topic (opposite polarity)`,
    };
  }
  return { conflict: false };
}

/** Read the vault's verified facts, for the gate's contradiction check. */
export async function loadVerifiedFacts(root: string): Promise<VaultRecord[]> {
  const tracked = await listTracked(root, ".");
  const files = tracked.filter((f) => f.endsWith(".md") && RECORD_DIRS.some((d) => f.startsWith(`${d}/`)));
  const out: VaultRecord[] = [];
  for (const f of files) {
    try {
      const record = parseRecord(await readVaultFile(root, f));
      if (record.meta.kind === "fact" && record.meta.status === "verified") out.push(record);
    } catch {
      // Unreadable records are skipped; they surface through verify and the gate elsewhere.
    }
  }
  return out;
}
