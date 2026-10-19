import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

/**
 * policy.yml loader and the effective-policy resolver.
 *
 * Invariants enforced here:
 *  - Fail closed. A missing, unreadable, or invalid policy resolves to ask for
 *    everything and deny all writes. Nothing is ever auto-permitted by accident.
 *  - Agent identity is established by the server, never taken from a model
 *    argument. Resolution takes an agentId the caller got from configuration;
 *    with no trustworthy identity, resolution falls to the most restrictive
 *    outcome (no auto).
 *  - The secret and PII classes are hard: they resolve to never regardless of
 *    the file or any agent rule.
 *  - Nothing here writes policy.yml. There is no setter.
 */

export type LoadMode = "ask" | "auto" | "manual";
export type ProposeMode = "ask" | "auto" | "never";
export type OnWrite = "pull_request" | "direct_commit";

export const HARD_NEVER_CLASSES = ["secret-or-credential", "customer-pii"] as const;

const loadMode = z.enum(["ask", "auto", "manual"]);
const proposeMode = z.enum(["ask", "auto", "never"]);
const onWrite = z.enum(["pull_request", "direct_commit"]);

const rule = z.object({
  load: loadMode.optional(),
  propose: proposeMode.optional(),
  on_write: onWrite.optional(),
});

const policySchema = z.object({
  defaults: z.object({ load: loadMode, propose: proposeMode, on_write: onWrite }),
  classes: z.record(z.string(), rule).default({}),
  paths: z
    .object({
      readable: z.array(z.string()).default([]),
      writable: z.array(z.string()).default([]),
      deny: z.array(z.string()).default([]),
    })
    .default({ readable: [], writable: [], deny: [] }),
  agents: z.record(z.string(), rule).default({}),
});

export type Policy = z.infer<typeof policySchema>;

export interface LoadedPolicy {
  policy: Policy;
  degraded: boolean;
  reason?: string;
}

export interface EffectivePolicy {
  load: LoadMode;
  propose: ProposeMode;
  on_write: OnWrite;
}

/** The maximally restrictive policy used whenever the real one cannot be trusted. */
export function failClosedPolicy(reason: string): LoadedPolicy {
  return {
    degraded: true,
    reason,
    policy: {
      defaults: { load: "ask", propose: "ask", on_write: "pull_request" },
      classes: {},
      paths: { readable: [], writable: [], deny: ["**"] },
      agents: {},
    },
  };
}

/** Parse and validate policy text. Any problem fails closed with a reason. */
export function loadPolicyFromText(text: string): LoadedPolicy {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    return failClosedPolicy(`policy.yml is not valid YAML: ${err instanceof Error ? err.message : String(err)}`);
  }
  const result = policySchema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first ? `${first.path.join(".") || "(root)"}: ${first.message}` : "unknown field";
    return failClosedPolicy(`policy.yml is invalid: ${where}`);
  }
  return { policy: result.data, degraded: false };
}

/** Read and validate `<root>/.cohort/policy.yml`. Fails closed if absent or invalid. */
export async function loadPolicy(root: string): Promise<LoadedPolicy> {
  let text: string;
  try {
    text = await readFile(join(root, ".cohort", "policy.yml"), "utf8");
  } catch {
    return failClosedPolicy("policy.yml is missing; refusing to auto-permit anything");
  }
  return loadPolicyFromText(text);
}

function deAutoLoad(mode: LoadMode): LoadMode {
  return mode === "auto" ? "ask" : mode;
}

function deAutoPropose(mode: ProposeMode): ProposeMode {
  return mode === "auto" ? "ask" : mode;
}

/**
 * Resolve the effective policy for a class and agent.
 *
 * Precedence per field is agent over class over defaults. A class-level never
 * cannot be upgraded by an agent rule, and the hard never-classes always
 * resolve to never. An unknown class, or a missing (untrusted) agent identity,
 * can never resolve to auto.
 */
export function resolveEffective(
  policy: Policy,
  opts: { className?: string; agentId?: string | null } = {},
): EffectivePolicy {
  const { className, agentId } = opts;
  const d = policy.defaults;
  const cls = className ? policy.classes[className] : undefined;
  const agent = agentId ? policy.agents[agentId] : undefined;

  let load: LoadMode = agent?.load ?? cls?.load ?? d.load;
  let propose: ProposeMode = agent?.propose ?? cls?.propose ?? d.propose;
  const on_write: OnWrite = agent?.on_write ?? cls?.on_write ?? d.on_write;

  // A class that declares never cannot be upgraded by an agent rule.
  if (cls?.propose === "never") propose = "never";

  // The secret and PII classes are hard, whatever the file says.
  if (className && (HARD_NEVER_CLASSES as readonly string[]).includes(className)) {
    propose = "never";
  }

  // A class named but not configured must never resolve to auto.
  if (className && !cls) {
    load = deAutoLoad(load);
    propose = deAutoPropose(propose);
  }

  // No trustworthy identity means the most restrictive outcome: no auto.
  if (!agentId) {
    load = deAutoLoad(load);
    propose = deAutoPropose(propose);
  }

  return { load, propose, on_write };
}

/** A read-only snapshot for cohort_policy_get. There is no corresponding setter. */
export interface EffectivePolicyView {
  agent: string | null;
  degraded: boolean;
  reason?: string;
  defaults: EffectivePolicy;
  effective: EffectivePolicy;
  classes: string[];
  paths: Policy["paths"];
}

export function buildPolicyView(loaded: LoadedPolicy, agentId: string | null): EffectivePolicyView {
  const view: EffectivePolicyView = {
    agent: agentId,
    degraded: loaded.degraded,
    defaults: loaded.policy.defaults,
    effective: resolveEffective(loaded.policy, { agentId }),
    classes: Object.keys(loaded.policy.classes),
    paths: loaded.policy.paths,
  };
  if (loaded.reason !== undefined) view.reason = loaded.reason;
  return view;
}

/** Default provider for the running server: read the vault and the configured identity from the environment. */
export async function defaultPolicyView(env: Record<string, string | undefined>, cwd: string): Promise<EffectivePolicyView> {
  const root = env.COHORT_VAULT_DIR ?? cwd;
  const agentId = env.COHORT_AGENT_ID ?? null;
  const loaded = await loadPolicy(root);
  return buildPolicyView(loaded, agentId);
}
