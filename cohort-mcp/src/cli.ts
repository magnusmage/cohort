#!/usr/bin/env node
import process from "node:process";

import {
  claudeCodeAddArgs,
  installSkillFallback,
  seedPolicy,
  serverEntry,
  writeDesktopConfig,
} from "./init.js";
import { loadPolicy } from "./policy.js";
import { computeStats } from "./stats.js";
import { verifyRecords } from "./verify.js";

/**
 * The cohort CLI.
 *
 *   cohort init    seed the vault policy, wire Claude, print the next steps.
 *   cohort verify  human-only promotion of records to verified.
 *
 * verify is a CLI command on purpose, not an MCP tool: the model can propose
 * and read, but promotion is a human action run from the terminal.
 */

const USAGE = [
  "usage:",
  "  cohort init --vault <dir> --agent <id> [--scope user|project] [--desktop-config <path>]",
  "              [--no-mcp --skill-source <SKILL.md> --skill-dest <dir>]",
  "  cohort verify --vault <dir> --by <handle> <id> [<id>...]",
  "  cohort stats --vault <dir> [--agent <id>]",
].join("\n");

interface InitFlags {
  vaultDir?: string;
  agentId?: string;
  scope?: "user" | "project";
  desktopConfig?: string;
  noMcp?: boolean;
  skillSource?: string;
  skillDest?: string;
}

function parseInitFlags(args: string[]): InitFlags {
  const flags: InitFlags = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = (): string | undefined => args[(i += 1)];
    if (arg === "--vault") flags.vaultDir = next();
    else if (arg === "--agent") flags.agentId = next();
    else if (arg === "--scope") {
      const value = next();
      if (value === "user" || value === "project") flags.scope = value;
    } else if (arg === "--desktop-config") flags.desktopConfig = next();
    else if (arg === "--no-mcp") flags.noMcp = true;
    else if (arg === "--skill-source") flags.skillSource = next();
    else if (arg === "--skill-dest") flags.skillDest = next();
  }
  return flags;
}

async function runInit(args: string[]): Promise<void> {
  const flags = parseInitFlags(args);
  const vaultDir = flags.vaultDir;
  const agentId = flags.agentId;
  if (!vaultDir || !agentId) {
    process.stderr.write(`cohort init: --vault and --agent are required\n${USAGE}\n`);
    process.exit(2);
  }
  const opts = { vaultDir, agentId, ...(flags.scope ? { scope: flags.scope } : {}) };

  const seeded = await seedPolicy(vaultDir);
  process.stdout.write(seeded ? `seeded ${vaultDir}/.cohort/policy.yml\n` : `kept existing ${vaultDir}/.cohort/policy.yml\n`);

  if (flags.noMcp) {
    if (!flags.skillSource || !flags.skillDest) {
      process.stderr.write("cohort init --no-mcp needs --skill-source and --skill-dest\n");
      process.exit(2);
    }
    const dest = await installSkillFallback(flags.skillSource, flags.skillDest);
    process.stdout.write(`installed SKILL.md fallback to ${dest}\n`);
  } else {
    if (flags.desktopConfig) {
      await writeDesktopConfig(flags.desktopConfig, serverEntry(opts));
      process.stdout.write(`wrote Claude Desktop config at ${flags.desktopConfig}\n`);
    }
    process.stdout.write(`register with Claude Code:\n  claude ${claudeCodeAddArgs(opts).join(" ")}\n`);
  }

  process.stdout.write(
    "next: start your client with the vault as the project directory, and add teammates as GitHub collaborators.\n",
  );
}

async function runVerify(args: string[]): Promise<void> {
  let vaultDir: string | undefined;
  let by: string | undefined;
  const ids: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--vault") vaultDir = args[(i += 1)];
    else if (arg === "--by") by = args[(i += 1)];
    else if (arg && !arg.startsWith("--")) ids.push(arg);
  }
  if (!vaultDir || !by || ids.length === 0) {
    process.stderr.write(`cohort verify: --vault, --by, and at least one id are required\n${USAGE}\n`);
    process.exit(2);
  }
  const results = await verifyRecords(vaultDir, ids, by);
  for (const r of results) {
    process.stdout.write(`${r.id}: ${r.status}${r.reason ? ` (${r.reason})` : ""}\n`);
  }
  process.exit(results.some((r) => r.status === "error") ? 1 : 0);
}

async function runStats(args: string[]): Promise<void> {
  let vaultDir: string | undefined;
  let agentId: string | null = null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--vault") vaultDir = args[(i += 1)];
    else if (arg === "--agent") agentId = args[(i += 1)] ?? null;
  }
  if (!vaultDir) {
    process.stderr.write(`cohort stats: --vault is required\n${USAGE}\n`);
    process.exit(2);
  }
  const loaded = await loadPolicy(vaultDir);
  const s = await computeStats(vaultDir, loaded, agentId);
  const k = s.records.byKind;
  const st = s.records.byStatus;
  process.stdout.write(
    [
      `records: ${s.records.total} (fact ${k.fact}, decision ${k.decision}, thread ${k.thread})`,
      `status: verified ${st.verified}, quarantined ${st.quarantined}, proposed ${st.proposed}, superseded ${st.superseded}`,
      `writebacks: ${s.writebacks.recordCommits} commit(s) by ${s.writebacks.contributors} contributor(s)`,
      `current load: ~${s.currentLoad.approxTokens} tokens`,
      `not tracked: ${s.notTracked.join(", ")}`,
      s.note,
      "",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "init") await runInit(rest);
  else if (command === "verify") await runVerify(rest);
  else if (command === "stats") await runStats(rest);
  else {
    process.stdout.write(`${USAGE}\n`);
    process.exit(command ? 1 : 0);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`cohort: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
