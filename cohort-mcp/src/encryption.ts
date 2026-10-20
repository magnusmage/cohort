import { readFile } from "node:fs/promises";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { matchesAny } from "./gate.js";
import { listTracked } from "./git.js";

/**
 * At-rest encryption for sensitive vault content.
 *
 * Cohort does not implement its own cryptography. Encryption at rest is done by
 * a standard, audited tool, git-crypt or age, through git's clean and smudge
 * filters: the configured paths are stored encrypted in the repository and are
 * transparent in the working tree to anyone who holds the key. This module owns
 * the parts that are ours to get right: which paths are marked sensitive, the
 * .gitattributes wiring that routes them through the encryption filter, and the
 * key hygiene that keeps keys out of git.
 *
 * Keys are the whole risk. This module never reads, writes, generates, or logs
 * a key; it only checks, by filename pattern, that no key is tracked in git and
 * that key paths are ignored. The key lives outside the repository and is
 * provided to git-crypt or age out of band.
 */

const BEGIN = "# cohort:encryption (generated) - do not edit between the markers";
const END = "# cohort:encryption (end)";

// Filenames that look like key material and must never be committed.
export const SENSITIVE_FILE_GLOBS = [
  "**/*.key",
  "**/*.agekey",
  "**/*.age-key",
  "**/age-identity.txt",
  "**/git-crypt-key",
  "**/*.gpg-key",
  ".cohort/keys/**",
];

const configSchema = z.object({
  version: z.number().optional(),
  tool: z.enum(["git-crypt", "age"]).default("git-crypt"),
  encrypt: z.array(z.string()).default([]),
});

export type EncryptionConfig = z.infer<typeof configSchema>;

/** Parse an encryption config. Throws on malformed input so callers fail closed. */
export function loadEncryptionFromText(text: string): EncryptionConfig {
  const parsed = configSchema.safeParse(parseYaml(text));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(`invalid encryption config: ${first ? `${first.path.join(".") || "(root)"}: ${first.message}` : "unknown"}`);
  }
  return parsed.data;
}

/** The .gitattributes lines that route the configured paths through the encryption filter. */
export function gitattributesBlock(cfg: EncryptionConfig): string {
  const filter = cfg.tool === "age" ? "age" : "git-crypt";
  const lines = cfg.encrypt.map((glob) => `${glob} filter=${filter} diff=${filter}`);
  return [BEGIN, ...lines, END].join("\n");
}

/** The .gitignore lines that keep key material out of git. */
export function gitignoreBlock(): string {
  return [BEGIN, ...SENSITIVE_FILE_GLOBS, END].join("\n");
}

/** Insert or replace a generated block between the markers, leaving the rest of the file untouched. */
export function upsertBlock(existing: string, block: string): string {
  const start = existing.indexOf(BEGIN);
  if (start === -1) {
    const sep = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
    return `${existing}${sep}${block}\n`;
  }
  const end = existing.indexOf(END, start);
  const tail = end === -1 ? "" : existing.slice(end + END.length);
  return `${existing.slice(0, start)}${block}${tail}`;
}

export interface HygieneReport {
  ok: boolean;
  problems: string[];
}

/**
 * Check the key hygiene and the filter wiring. It fails if a key is tracked in
 * git, if a path marked for encryption is not routed through the filter (so it
 * would be committed in plaintext), or if the key patterns are not ignored.
 */
export async function checkHygiene(
  root: string,
  cfg: EncryptionConfig,
  files: { gitattributes: string; gitignore: string },
): Promise<HygieneReport> {
  const problems: string[] = [];

  const tracked = await listTracked(root, ".");
  for (const f of tracked) {
    if (matchesAny(SENSITIVE_FILE_GLOBS, f)) problems.push(`a key file is tracked in git: ${f}`);
  }

  for (const glob of cfg.encrypt) {
    if (!files.gitattributes.includes(glob)) {
      problems.push(`path marked for encryption is not wired into .gitattributes: ${glob}`);
    }
  }

  for (const pat of SENSITIVE_FILE_GLOBS) {
    if (!files.gitignore.includes(pat)) problems.push(`key pattern is not in .gitignore: ${pat}`);
  }

  return { ok: problems.length === 0, problems };
}

/** Read a file or return an empty string when it is absent. */
export async function readOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}
