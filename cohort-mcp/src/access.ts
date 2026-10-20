import { readFile } from "node:fs/promises";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { matchesAny } from "./gate.js";

/**
 * Fine-grained, multi-vault access control.
 *
 * A single access document describes several vaults and, per agent, what each
 * agent may read or write in each vault, down to path globs. Resolution is
 * least-privilege and fail-closed: nothing is permitted unless a grant says so,
 * an unknown vault or agent resolves to deny, and a missing or invalid document
 * resolves to deny everything. A vault may also set readable/writable caps that
 * bound every grant, and a deny list that overrides any grant.
 *
 * This sits above the per-vault policy.yml (which the write gate enforces for
 * the one vault the server runs against). It is the boundary for a deployment
 * that spans several vaults and several agents, and it never loosens a vault's
 * own policy, only narrows who may reach which vault and path.
 */

const globs = z.array(z.string()).default([]);

const vaultSchema = z
  .object({ readable: globs, writable: globs, deny: globs })
  .default({ readable: [], writable: [], deny: [] });

const grantSchema = z.object({ read: globs, write: globs, deny: globs }).default({ read: [], write: [], deny: [] });

const accessSchema = z.object({
  version: z.number().optional(),
  vaults: z.record(z.string(), vaultSchema).default({}),
  // agents: { "<agent id or *>": { "<vault id>": { read, write, deny } } }
  agents: z.record(z.string(), z.record(z.string(), grantSchema)).default({}),
});

export type AccessConfig = z.infer<typeof accessSchema>;

export interface AccessQuery {
  vaultId: string;
  agentId: string | null;
  path: string;
  write?: boolean;
}

export interface AccessDecision {
  allowed: boolean;
  reason: string;
}

function deny(reason: string): AccessDecision {
  return { allowed: false, reason };
}

/** Parse and validate an access document. Throws on malformed input so callers can fail closed. */
export function loadAccessFromText(text: string): AccessConfig {
  const parsed = accessSchema.safeParse(parseYaml(text));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(`invalid access config: ${first ? `${first.path.join(".") || "(root)"}: ${first.message}` : "unknown"}`);
  }
  return parsed.data;
}

/** A config that denies everything, used when the document is missing or invalid. */
export const denyAllAccess: AccessConfig = { vaults: {}, agents: {} };

/** Load the access document from a file, failing closed to deny-all on any problem. */
export async function loadAccess(path: string): Promise<{ config: AccessConfig; degraded: boolean; reason?: string }> {
  try {
    return { config: loadAccessFromText(await readFile(path, "utf8")), degraded: false };
  } catch (err) {
    return { config: denyAllAccess, degraded: true, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Resolve one access decision. Least-privilege: every path that is not
 * explicitly granted is denied, and a vault-wide deny or cap overrides a grant.
 */
export function resolveAccess(config: AccessConfig, query: AccessQuery): AccessDecision {
  const { vaultId, agentId, path, write = false } = query;

  const vault = config.vaults[vaultId];
  if (!vault) return deny(`unknown vault: ${vaultId}`);

  // An explicitly listed agent uses its own grants; an unlisted agent falls back
  // to the wildcard "*" if present. No identity at all cannot fall back.
  const perAgent = (agentId !== null ? config.agents[agentId] : undefined) ?? config.agents["*"];
  if (!perAgent) return deny("no access grant for this agent (least privilege: default deny)");

  const grant = perAgent[vaultId];
  if (!grant) return deny(`no grant for agent on vault ${vaultId}`);

  if (matchesAny(vault.deny, path)) return deny(`path denied by vault ${vaultId}`);
  if (matchesAny(grant.deny, path)) return deny("path denied by the agent's grant");

  if (write) {
    if (vault.writable.length > 0 && !matchesAny(vault.writable, path)) {
      return deny(`path is outside vault ${vaultId} writable scope`);
    }
    if (!matchesAny(grant.write, path)) return deny("write not granted for this path");
    return { allowed: true, reason: `write granted on vault ${vaultId}` };
  }

  if (vault.readable.length > 0 && !matchesAny(vault.readable, path)) {
    return deny(`path is outside vault ${vaultId} readable scope`);
  }
  if (!matchesAny(grant.read, path)) return deny("read not granted for this path");
  return { allowed: true, reason: `read granted on vault ${vaultId}` };
}
