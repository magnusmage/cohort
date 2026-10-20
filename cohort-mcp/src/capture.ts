import type { ProposeItem } from "./propose.js";
import { type VaultRecord, createRecord } from "./record.js";

/**
 * Auto session-capture: turn session notes into classified draft records.
 *
 * The extractor is deterministic and marker-based on purpose: it recognizes
 * explicit lines (Fact:, Decision:, Convention:, Thread:/Open:/TODO:) and
 * never invents content, so what it captures is auditable. The result is a set
 * of drafts for a human to edit and approve. Capture itself lands nothing: the
 * drafts go through the normal write gate like any other proposal, so they are
 * secret-scanned, linted, and policy-checked, and an agent-asserted draft stays
 * quarantined until a human verifies it.
 */

interface Marker {
  pattern: RegExp;
  kind: ProposeItem["kind"];
  cls?: string;
}

const MARKERS: Marker[] = [
  { pattern: /^\s*(?:convention|rule)\s*:\s*(.+\S)\s*$/i, kind: "fact", cls: "coding-convention" },
  { pattern: /^\s*(?:decision|decided)\s*:\s*(.+\S)\s*$/i, kind: "decision", cls: "architecture-decision" },
  { pattern: /^\s*(?:fact|learned|note)\s*:\s*(.+\S)\s*$/i, kind: "fact" },
  { pattern: /^\s*(?:thread|open|todo|blocked)\s*:\s*(.+\S)\s*$/i, kind: "thread" },
];

/** Extract classified candidate items from session notes, in order of appearance. */
export function extractCandidates(sessionText: string): ProposeItem[] {
  const candidates: ProposeItem[] = [];
  for (const line of sessionText.split("\n")) {
    for (const marker of MARKERS) {
      const match = marker.pattern.exec(line);
      if (match && match[1]) {
        const item: ProposeItem = { kind: marker.kind, text: match[1].trim() };
        if (marker.cls) item.class = marker.cls;
        candidates.push(item);
        break; // first matching marker wins for a line
      }
    }
  }
  return candidates;
}

/** Build preview draft records (quarantined, provenance stamped). Nothing is landed. */
export function draftsFrom(
  candidates: ProposeItem[],
  source: { agent: string; model: string; commit?: string | null },
): VaultRecord[] {
  return candidates.map((c) => createRecord({ kind: c.kind, text: c.text, source }));
}

/** Capture a session into candidates (ready for the gate) and preview drafts. */
export function captureSession(
  sessionText: string,
  source: { agent: string; model: string; commit?: string | null },
): { candidates: ProposeItem[]; drafts: VaultRecord[] } {
  const candidates = extractCandidates(sessionText);
  return { candidates, drafts: draftsFrom(candidates, source) };
}
