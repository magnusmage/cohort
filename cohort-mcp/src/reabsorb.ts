import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { collectRecords } from "./bridge.js";
import { ghPrOpener } from "./git.js";
import { type LoadedPolicy, loadPolicy } from "./policy.js";
import { type ProposeDeps, type ProposeItem, type ProposeItemResult, runProposals } from "./propose.js";
import { makeGitleaksScanner } from "./scan.js";

/**
 * Two-way sync: reabsorb hand-edits to the generated bridge files as proposals.
 *
 * A generated file (AGENTS.md, CLAUDE.md, Cursor rules) that a human edited is
 * untrusted input. Reabsorb parses its bullets back into candidate records,
 * drops the ones already in the vault, and runs the rest through the normal
 * write gate (secret scan, instruction linter, policy). Nothing is written back
 * silently: new content lands only as the gate allows, and an ask-class edit is
 * held for approval.
 */

const SECTION_KIND: Record<string, ProposeItem["kind"]> = {
  Decisions: "decision",
  "Conventions and facts": "fact",
  "Open threads": "thread",
};

function flatten(text: string): string {
  return text.replace(/\s*\n\s*/g, " ").trim();
}

/** Parse the bullets of a generated bridge file back into candidate items. */
export function parseBridgeItems(fileText: string): ProposeItem[] {
  const items: ProposeItem[] = [];
  let kind: ProposeItem["kind"] | null = null;
  for (const line of fileText.split("\n")) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading && heading[1]) {
      kind = SECTION_KIND[heading[1]] ?? null;
      continue;
    }
    const bullet = /^-\s+(.+\S)\s*$/.exec(line);
    if (bullet && kind && bullet[1]) items.push({ kind, text: bullet[1].trim() });
  }
  return items;
}

/** Reabsorb a hand-edited bridge file: propose the new bullets through the gate. */
export async function reabsorb(
  root: string,
  loaded: LoadedPolicy,
  agentId: string | null,
  fileText: string,
  deps: ProposeDeps,
): Promise<{ newItems: ProposeItem[]; results: ProposeItemResult[] }> {
  const parsed = parseBridgeItems(fileText);
  const existing = new Set((await collectRecords(root, true)).map((r) => flatten(r.text)));
  const newItems = parsed.filter((p) => !existing.has(flatten(p.text)));
  const results = await runProposals(root, loaded, agentId, newItems, deps);
  return { newItems, results };
}

/** Read a bridge file under the vault and reabsorb it with the real gate dependencies. */
export async function reabsorbFile(
  root: string,
  target: string,
  agentId: string | null,
  model?: string,
): Promise<{ newItems: ProposeItem[]; results: ProposeItemResult[] }> {
  const loaded = await loadPolicy(root);
  const scanner = makeGitleaksScanner(join(root, "security", "redaction-rules.toml"));
  const deps: ProposeDeps = { scanner, prOpener: ghPrOpener };
  if (model !== undefined) deps.model = model;
  const fileText = await readFile(join(root, target), "utf8");
  return reabsorb(root, loaded, agentId, fileText, deps);
}
