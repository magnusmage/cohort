#!/usr/bin/env node
import process from "node:process";

import {
  claudeCodeAddArgs,
  installSkillFallback,
  seedPolicy,
  serverEntry,
  writeDesktopConfig,
} from "./init.js";

/**
 * cohort init: seed the vault policy, wire Claude, and print the next steps.
 *
 * External tools (claude mcp add, the setup wizard, gh) are the user's to run;
 * this command does the deterministic, idempotent parts (seed policy.yml, write
 * the Desktop config, or install the SKILL.md fallback) and prints the exact,
 * version-pinned registration command.
 */

interface Flags {
  vaultDir?: string;
  agentId?: string;
  scope?: "user" | "project";
  desktopConfig?: string;
  noMcp?: boolean;
  skillSource?: string;
  skillDest?: string;
}

function parseFlags(args: string[]): Flags {
  const flags: Flags = {};
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

const USAGE =
  "usage: cohort init --vault <dir> --agent <id> [--scope user|project] [--desktop-config <path>] [--no-mcp --skill-source <SKILL.md> --skill-dest <dir>]";

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command !== "init") {
    process.stdout.write(`${USAGE}\n`);
    process.exit(command ? 1 : 0);
  }

  const flags = parseFlags(rest);
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

main().catch((err: unknown) => {
  process.stderr.write(`cohort: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
