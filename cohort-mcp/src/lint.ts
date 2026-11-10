/**
 * Instruction linter for the write gate.
 *
 * This flags the shapes of a prompt-injection writeback: text that tries to be
 * an instruction, a role change, a prompt exfiltration, or a tool call. A hit
 * keeps a record from auto-landing; it is held for a human.
 *
 * The ruleset is versioned and ships with the server, not the vault. Unlike the
 * gitleaks redaction rules (which a team may extend in its own vault), this
 * ruleset is not vault-overridable, so poisoned vault content cannot weaken the
 * linter. Bump RULESET_VERSION when the rules change.
 */

export const RULESET_VERSION = "2";

export interface LintRule {
  id: string;
  label: string;
  pattern: RegExp;
}

export const RULES: LintRule[] = [
  { id: "override-previous", label: "override of prior instructions", pattern: /ignore\s+(all\s+)?(the\s+)?(previous|prior|above|earlier)\s+(instructions|messages|context|rules)/i },
  { id: "disregard", label: "disregard directive", pattern: /disregard\s+(the\s+)?(above|previous|prior|earlier|system)\b/i },
  { id: "forget", label: "forget-everything directive", pattern: /\b(forget|discard)\s+(everything|all|the\s+above|previous)\b/i },
  { id: "new-instructions", label: "new-instructions preamble", pattern: /\b(new|updated|revised)\s+instructions\s*:/i },
  { id: "imperative-override", label: "imperative override", pattern: /\byou\s+(must|should|will)\s+(now\s+)?(ignore|disregard|forget|override|bypass)\b/i },
  { id: "role-override", label: "role override", pattern: /\b(you\s+are\s+now|from\s+now\s+on\s+you\s+are|act\s+as)\b/i },
  { id: "system-prompt", label: "system-prompt reference", pattern: /\b(system|developer)\s+prompt\b/i },
  { id: "reveal-prompt", label: "prompt-exfiltration attempt", pattern: /\b(reveal|print|show|repeat|output)\s+(your\s+)?(system\s+|the\s+)?(prompt|instructions)\b/i },
  { id: "tool-markup", label: "tool-call-shaped markup", pattern: /<\/?(tool_call|function_call|tool|function|system|assistant)\b/i },
  { id: "tool-json", label: "tool-call JSON shape", pattern: /"(tool_calls?|function_call|role)"\s*:/i },
  { id: "code-fence-tool", label: "tool or system code fence", pattern: /```(tool|function|system|assistant)\b/i },
  { id: "exfiltrate", label: "exfiltration directive", pattern: /\b(exfiltrate|leak|send|post|upload)\s+(the\s+)?(secrets?|keys?|tokens?|credentials?|env|\.env)\b/i },
];

export interface LintResult {
  flagged: boolean;
  reasons: string[];
  ruleIds: string[];
  version: string;
}

/**
 * Fold the easy evasions before matching. NFKC collapses compatibility forms
 * (for example fullwidth Latin letters) to their plain equivalents, and runs of
 * whitespace become a single space, so spacing and compatibility tricks do not
 * slip a directive past the patterns. Record-level validation already rejects
 * zero-width and bidirectional control characters, so this focuses on the
 * remaining compatibility and spacing shapes.
 */
export function normalizeForLint(content: string): string {
  return content.normalize("NFKC").replace(/\s+/g, " ");
}

export function lintForInjection(content: string): LintResult {
  const normalized = normalizeForLint(content);
  const reasons: string[] = [];
  const ruleIds: string[] = [];
  for (const rule of RULES) {
    if (rule.pattern.test(normalized)) {
      reasons.push(rule.label);
      ruleIds.push(rule.id);
    }
  }
  return { flagged: reasons.length > 0, reasons, ruleIds, version: RULESET_VERSION };
}
