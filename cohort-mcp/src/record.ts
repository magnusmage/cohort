import { createHash } from "node:crypto";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

/**
 * Record envelope: a vault record is YAML frontmatter (metadata) plus a
 * markdown body (the record's text). Keeping the text as the body, not a
 * quoted YAML field, is what makes records readable and diffable in an editor,
 * which the vault depends on.
 *
 * Every field is validated: lengths are bounded, control characters are
 * rejected, and scalar fields are held to a safe character set, so a hostile
 * record cannot break the frontmatter or carry invisible payloads. Machine
 * written records land `quarantined`; promotion to `verified` is a later,
 * human-only step. The id is content addressed, so the same text yields the
 * same id (ready for dedup) and provenance can be checked against git history.
 */

export class RecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordError";
  }
}

export type Kind = "fact" | "decision" | "thread";

const KIND_PREFIX: Record<Kind, string> = { fact: "f", decision: "d", thread: "t" };

// Printable, no newline, bounded. Covers handles like "claude-code@alice".
const SAFE_SCALAR = /^[\w .@:+/-]{1,200}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// Control characters except tab (09) and newline (0A). Matching control
// characters here is the point: these are what we reject in record content.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f]/;

const safeScalar = z.string().regex(SAFE_SCALAR, "must be a short scalar with no control characters");
const dateOrNull = z.union([z.string().regex(DATE, "must be YYYY-MM-DD"), z.null()]);

const sourceSchema = z.object({
  agent: safeScalar,
  model: safeScalar,
  commit: z.union([z.string().regex(/^[0-9a-f]{7,40}$/, "must be a git sha or null"), z.null()]),
});

const metaSchema = z.object({
  id: z.string().regex(/^[fdt]-[0-9a-f]{12}$/, "must be a content-addressed record id"),
  kind: z.enum(["fact", "decision", "thread"]),
  status: z.enum(["proposed", "quarantined", "verified", "superseded"]),
  confidence: z.enum(["low", "medium", "high"]),
  added: z.string().regex(DATE, "must be YYYY-MM-DD"),
  review_by: dateOrNull,
  supersedes: z.union([z.string(), z.null()]),
  verified_by: z.union([safeScalar, z.null()]),
  owner: safeScalar.optional(),
  state: z.enum(["open", "blocked", "done"]).optional(),
  blocked_on: z.union([z.string(), z.null()]).optional(),
  source: sourceSchema,
});

export type RecordMeta = z.infer<typeof metaSchema>;

export interface VaultRecord {
  meta: RecordMeta;
  text: string;
}

export interface CreateRecordInput {
  kind: Kind;
  text: string;
  source: { agent: string; model: string; commit?: string | null };
  confidence?: "low" | "medium" | "high";
  added?: string;
  owner?: string;
  state?: "open" | "blocked" | "done";
  blockedOn?: string | null;
}

function assertText(text: string): void {
  if (text.length < 1) throw new RecordError("record text must not be empty");
  if (text.length > 20000) throw new RecordError("record text exceeds 20000 characters");
  if (CONTROL_CHARS.test(text)) throw new RecordError("record text contains control characters");
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Content-addressed id: a short sha256 over the kind and the normalized text. */
export function computeId(kind: Kind, text: string): string {
  const hash = createHash("sha256").update(`${kind}\n${text.trim()}`).digest("hex").slice(0, 12);
  return `${KIND_PREFIX[kind]}-${hash}`;
}

function validateMeta(meta: unknown): RecordMeta {
  const result = metaSchema.safeParse(meta);
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first ? `${first.path.join(".") || "(root)"}: ${first.message}` : "unknown field";
    throw new RecordError(`invalid record frontmatter: ${where}`);
  }
  return result.data;
}

/** Build a validated, provenance-stamped record. Machine writes land quarantined. */
export function createRecord(input: CreateRecordInput): VaultRecord {
  assertText(input.text);
  const meta: Record<string, unknown> = {
    id: computeId(input.kind, input.text),
    kind: input.kind,
    status: "quarantined",
    confidence: input.confidence ?? "medium",
    added: input.added ?? today(),
    review_by: null,
    supersedes: null,
    verified_by: null,
  };
  if (input.owner !== undefined) meta.owner = input.owner;
  if (input.state !== undefined) meta.state = input.state;
  if (input.blockedOn !== undefined) meta.blocked_on = input.blockedOn;
  meta.source = {
    agent: input.source.agent,
    model: input.source.model,
    commit: input.source.commit ?? null,
  };
  return { meta: validateMeta(meta), text: input.text };
}

/** Canonical field order, for stable frontmatter and clean diffs. */
function orderedMeta(meta: RecordMeta): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: meta.id,
    kind: meta.kind,
    status: meta.status,
    confidence: meta.confidence,
    added: meta.added,
    review_by: meta.review_by,
    supersedes: meta.supersedes,
    verified_by: meta.verified_by,
  };
  if (meta.owner !== undefined) out.owner = meta.owner;
  if (meta.state !== undefined) out.state = meta.state;
  if (meta.blocked_on !== undefined) out.blocked_on = meta.blocked_on;
  out.source = meta.source;
  return out;
}

/** Serialize to `---` frontmatter plus the markdown body, verbatim. */
export function serializeRecord(record: VaultRecord): string {
  assertText(record.text);
  const meta = validateMeta(record.meta);
  const frontmatter = stringifyYaml(orderedMeta(meta), { lineWidth: 0 });
  return `---\n${frontmatter}---\n${record.text}`;
}

/** Parse a record, validating the frontmatter and the body. Fails closed. */
export function parseRecord(input: string): VaultRecord {
  if (!input.startsWith("---\n")) {
    throw new RecordError("record is missing its frontmatter opening");
  }
  const rest = input.slice(4);
  const close = rest.indexOf("\n---\n");
  if (close === -1) {
    throw new RecordError("record is missing its frontmatter closing");
  }
  const frontmatter = rest.slice(0, close);
  const text = rest.slice(close + 5);

  let parsed: unknown;
  try {
    parsed = parseYaml(frontmatter);
  } catch (err) {
    throw new RecordError(`frontmatter is not valid YAML: ${err instanceof Error ? err.message : String(err)}`);
  }
  assertText(text);
  return { meta: validateMeta(parsed), text };
}
