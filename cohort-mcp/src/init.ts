import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { SERVER_VERSION } from "./server.js";

/**
 * cohort init helpers: one-command install and Claude wiring.
 *
 * The server version is pinned in every registration, so an install never
 * floats to "latest from npm". The server-established agent identity is written
 * into the client config at init time, so per-agent policy cannot be forged at
 * call time. Seeding and config writes are idempotent and never clobber an
 * existing policy.yml. All of this is additive: the SKILL.md connector stays
 * the fallback for a client with no MCP.
 */

/** The pinned npx spec used in every registration. Never floating. */
export const PINNED_SPEC = `cohort-mcp@${SERVER_VERSION}`;

export interface InitOptions {
  vaultDir: string;
  agentId: string;
  scope?: "user" | "project";
}

export interface McpServerEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** The Claude Desktop config entry for the Cohort server. */
export function serverEntry(opts: InitOptions): McpServerEntry {
  return {
    command: "npx",
    args: ["-y", PINNED_SPEC],
    env: { COHORT_VAULT_DIR: opts.vaultDir, COHORT_AGENT_ID: opts.agentId },
  };
}

/** Argument array for `claude mcp add`. Arrays only, so no value is shell-interpolated. */
export function claudeCodeAddArgs(opts: InitOptions): string[] {
  return [
    "mcp",
    "add",
    "cohort",
    "--scope",
    opts.scope ?? "user",
    "--env",
    `COHORT_VAULT_DIR=${opts.vaultDir}`,
    "--env",
    `COHORT_AGENT_ID=${opts.agentId}`,
    "--",
    "npx",
    "-y",
    PINNED_SPEC,
  ];
}

/** Merge the Cohort entry into a Claude Desktop config object, preserving other servers. */
export function mergeDesktopConfig(existing: Record<string, unknown>, entry: McpServerEntry): Record<string, unknown> {
  const current = existing.mcpServers;
  const servers = current && typeof current === "object" ? { ...(current as Record<string, unknown>) } : {};
  servers.cohort = entry;
  return { ...existing, mcpServers: servers };
}

/** Write the Claude Desktop config idempotently, preserving any other servers already present. */
export async function writeDesktopConfig(path: string, entry: McpServerEntry): Promise<void> {
  let existing: Record<string, unknown>;
  try {
    existing = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    existing = {};
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(mergeDesktopConfig(existing, entry), null, 2)}\n`, "utf8");
}

/** The starter policy.yml: ask by default, hard never-classes, scoped paths. */
export function starterPolicyYaml(): string {
  return `defaults:
  load: ask
  propose: ask
  on_write: pull_request

classes:
  coding-convention: { propose: auto }
  architecture-decision: { propose: ask }
  secret-or-credential: { propose: never }
  customer-pii: { propose: never }

paths:
  readable: ["facts/**", "decisions/**", "threads/**"]
  writable: ["facts/**", "decisions/**", "threads/**"]
  deny: ["**/.env", "**/*secret*", "private/**"]

agents: {}
`;
}

/** Seed `.cohort/policy.yml` only when absent. Returns true if it wrote one. Never clobbers. */
export async function seedPolicy(vaultRoot: string): Promise<boolean> {
  const path = join(vaultRoot, ".cohort", "policy.yml");
  try {
    await access(path);
    return false;
  } catch {
    // not present: seed it
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, starterPolicyYaml(), "utf8");
  return true;
}

/** Fallback for a client without MCP: copy the SKILL.md connector into place. */
export async function installSkillFallback(skillSource: string, destDir: string): Promise<string> {
  await mkdir(destDir, { recursive: true });
  const dest = join(destDir, "SKILL.md");
  await copyFile(skillSource, dest);
  return dest;
}
