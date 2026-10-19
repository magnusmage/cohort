/**
 * Minimal instruction linter for the write gate.
 *
 * This is the Phase 1 guard: it flags the obvious shapes of a prompt-injection
 * writeback (text that tries to be an instruction or a tool call) so the gate
 * can refuse to auto-land it. The full, versioned linter with quarantine tiers
 * is Phase 2 (#42). A flag never blocks a human-approved write; it only
 * prevents an automatic one.
 */

export interface LintResult {
  flagged: boolean;
  reasons: string[];
}

const PATTERNS: Array<[RegExp, string]> = [
  [/ignore\s+(all\s+)?(the\s+)?(previous|prior|above)\s+instructions/i, "override of prior instructions"],
  [/disregard\s+(the\s+)?(above|previous|prior)\b/i, "disregard directive"],
  [/\byou\s+must\s+(now\s+)?(ignore|disregard|forget)\b/i, "imperative override"],
  [/\bsystem\s+prompt\b/i, "system-prompt reference"],
  [/<\/?(tool_call|function_call|tool)\b/i, "tool-call-shaped markup"],
  [/```(tool|function|system)\b/i, "tool or system code fence"],
  [/"(tool_calls?|function_call)"\s*:/i, "tool-call JSON shape"],
];

export function lintForInjection(content: string): LintResult {
  const reasons: string[] = [];
  for (const [pattern, label] of PATTERNS) {
    if (pattern.test(content)) reasons.push(label);
  }
  return { flagged: reasons.length > 0, reasons };
}
