#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

import {
  claudeCodeAddArgs,
  installSkillFallback,
  seedPolicy,
  serverEntry,
  writeDesktopConfig,
} from "./init.js";
import { loadAccess, resolveAccess } from "./access.js";
import { generateBridge } from "./bridge.js";
import {
  checkHygiene,
  gitattributesBlock,
  gitignoreBlock,
  loadEncryptionFromText,
  readOrEmpty,
  upsertBlock,
} from "./encryption.js";
import { buildIndex, indexStatus, writeIndex } from "./indexer.js";
import { exportVault, importVault, parsePortable, serializePortable } from "./portable.js";
import { loadPolicy } from "./policy.js";
import { reabsorbFile } from "./reabsorb.js";
import { computeStats } from "./stats.js";
import { supersedeRecord } from "./supersede.js";
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
  "  cohort supersede --vault <dir> --old <id> --new <id>",
  "  cohort stats --vault <dir> [--agent <id>]",
  "  cohort index --vault <dir> [--check]",
  "  cohort bridge --vault <dir> [--include-quarantined]",
  "  cohort reabsorb --vault <dir> --file <name> [--agent <id>]",
  "  cohort export --vault <dir> [--out <file>]",
  "  cohort import --vault <dir> --in <file>",
  "  cohort access --config <file> --vault <id> --path <p> [--agent <id>] [--write]",
  "  cohort encrypt-setup --vault <dir>    # wire .gitattributes and .gitignore for at-rest encryption",
  "  cohort encrypt-check --vault <dir>    # verify no key is tracked and sensitive paths are encrypted",
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

async function runSupersede(args: string[]): Promise<void> {
  let vaultDir: string | undefined;
  let oldId: string | undefined;
  let newId: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--vault") vaultDir = args[(i += 1)];
    else if (arg === "--old") oldId = args[(i += 1)];
    else if (arg === "--new") newId = args[(i += 1)];
  }
  if (!vaultDir || !oldId || !newId) {
    process.stderr.write(`cohort supersede: --vault, --old, and --new are required\n${USAGE}\n`);
    process.exit(2);
  }
  const r = await supersedeRecord(vaultDir, oldId, newId);
  process.stdout.write(`${r.oldId} -> ${r.newId}: ${r.status}${r.reason ? ` (${r.reason})` : ""}\n`);
  process.exit(r.status === "superseded" ? 0 : 1);
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

async function runIndex(args: string[]): Promise<void> {
  let vaultDir: string | undefined;
  let check = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--vault") vaultDir = args[(i += 1)];
    else if (arg === "--check") check = true;
  }
  if (!vaultDir) {
    process.stderr.write(`cohort index: --vault is required\n${USAGE}\n`);
    process.exit(2);
  }

  if (check) {
    const status = await indexStatus(vaultDir);
    if (status.inSync) {
      process.stdout.write("index is in sync with the vault\n");
      return;
    }
    if (!status.committed) process.stdout.write("index is not committed yet\n");
    if (status.missing.length) process.stdout.write(`missing ${status.missing.length}: ${status.missing.join(", ")}\n`);
    if (status.stale.length) process.stdout.write(`stale ${status.stale.length}: ${status.stale.join(", ")}\n`);
    if (status.changed.length) process.stdout.write(`changed ${status.changed.length}: ${status.changed.join(", ")}\n`);
    process.stderr.write("run `cohort index --vault <dir>` to rebuild, then review and commit\n");
    process.exit(1);
  }

  const index = await buildIndex(vaultDir);
  const path = await writeIndex(vaultDir, index);
  process.stdout.write(`wrote ${path} with ${index.records.length} record(s); review and commit it\n`);
}

async function runBridge(args: string[]): Promise<void> {
  let vaultDir: string | undefined;
  let includeQuarantined = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--vault") vaultDir = args[(i += 1)];
    else if (arg === "--include-quarantined") includeQuarantined = true;
  }
  if (!vaultDir) {
    process.stderr.write(`cohort bridge: --vault is required\n${USAGE}\n`);
    process.exit(2);
  }
  const { written } = await generateBridge(vaultDir, { includeQuarantined });
  for (const path of written) process.stdout.write(`generated ${path}\n`);
}

async function runReabsorb(args: string[]): Promise<void> {
  let vaultDir: string | undefined;
  let file: string | undefined;
  let agentId: string | null = null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--vault") vaultDir = args[(i += 1)];
    else if (arg === "--file") file = args[(i += 1)];
    else if (arg === "--agent") agentId = args[(i += 1)] ?? null;
  }
  if (!vaultDir || !file) {
    process.stderr.write(`cohort reabsorb: --vault and --file are required\n${USAGE}\n`);
    process.exit(2);
  }
  const { newItems, results } = await reabsorbFile(vaultDir, file, agentId);
  process.stdout.write(`${newItems.length} new item(s) from ${file}\n`);
  for (const r of results) {
    process.stdout.write(`${r.kind} ${r.id}: ${r.decision}${r.reason ? ` (${r.reason})` : ""}\n`);
  }
}

async function runExport(args: string[]): Promise<void> {
  let vaultDir: string | undefined;
  let out: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--vault") vaultDir = args[(i += 1)];
    else if (arg === "--out") out = args[(i += 1)];
  }
  if (!vaultDir) {
    process.stderr.write(`cohort export: --vault is required\n${USAGE}\n`);
    process.exit(2);
  }
  const pv = await exportVault(vaultDir);
  const json = serializePortable(pv);
  if (out) {
    await writeFile(out, json, "utf8");
    process.stdout.write(`exported ${pv.records.length} record(s) to ${out}\n`);
  } else {
    process.stdout.write(json);
  }
}

async function runImport(args: string[]): Promise<void> {
  let vaultDir: string | undefined;
  let inFile: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--vault") vaultDir = args[(i += 1)];
    else if (arg === "--in") inFile = args[(i += 1)];
  }
  if (!vaultDir || !inFile) {
    process.stderr.write(`cohort import: --vault and --in are required\n${USAGE}\n`);
    process.exit(2);
  }
  const pv = parsePortable(await readFile(inFile, "utf8"));
  const written = await importVault(vaultDir, pv);
  process.stdout.write(`imported ${written.length} record(s); review and commit them\n`);
}

async function runAccess(args: string[]): Promise<void> {
  let config: string | undefined;
  let vaultId: string | undefined;
  let path: string | undefined;
  let agentId: string | null = null;
  let write = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--config") config = args[(i += 1)];
    else if (arg === "--vault") vaultId = args[(i += 1)];
    else if (arg === "--path") path = args[(i += 1)];
    else if (arg === "--agent") agentId = args[(i += 1)] ?? null;
    else if (arg === "--write") write = true;
  }
  if (!config || !vaultId || !path) {
    process.stderr.write(`cohort access: --config, --vault, and --path are required\n${USAGE}\n`);
    process.exit(2);
  }
  const { config: cfg, degraded, reason } = await loadAccess(config);
  if (degraded) process.stderr.write(`access config unreadable; failing closed to deny-all: ${reason ?? ""}\n`);
  const decision = resolveAccess(cfg, { vaultId, agentId, path, write });
  process.stdout.write(`${decision.allowed ? "allow" : "deny"} ${write ? "write" : "read"} ${vaultId}:${path} - ${decision.reason}\n`);
  process.exit(decision.allowed ? 0 : 1);
}

function vaultFlag(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--vault") return args[i + 1];
  }
  return undefined;
}

async function runEncryptSetup(args: string[]): Promise<void> {
  const vaultDir = vaultFlag(args);
  if (!vaultDir) {
    process.stderr.write(`cohort encrypt-setup: --vault is required\n${USAGE}\n`);
    process.exit(2);
  }
  const configText = await readOrEmpty(join(vaultDir, ".cohort", "encryption.yml"));
  if (!configText) {
    process.stderr.write("cohort encrypt-setup: create .cohort/encryption.yml first (tool and encrypt globs)\n");
    process.exit(2);
  }
  const cfg = loadEncryptionFromText(configText);
  const gaPath = join(vaultDir, ".gitattributes");
  const giPath = join(vaultDir, ".gitignore");
  await writeFile(gaPath, upsertBlock(await readOrEmpty(gaPath), gitattributesBlock(cfg)), "utf8");
  await writeFile(giPath, upsertBlock(await readOrEmpty(giPath), gitignoreBlock()), "utf8");
  process.stdout.write(
    [
      `wired ${cfg.encrypt.length} path(s) through the ${cfg.tool} filter in .gitattributes`,
      "key patterns added to .gitignore",
      cfg.tool === "git-crypt"
        ? "next: install git-crypt, run `git-crypt init`, and share the key out of band (never commit it)"
        : "next: install age, configure the age filter, and keep the identity file out of the repo (never commit it)",
      "then run `cohort encrypt-check --vault <dir>` before committing",
      "",
    ].join("\n"),
  );
}

async function runEncryptCheck(args: string[]): Promise<void> {
  const vaultDir = vaultFlag(args);
  if (!vaultDir) {
    process.stderr.write(`cohort encrypt-check: --vault is required\n${USAGE}\n`);
    process.exit(2);
  }
  const configText = await readOrEmpty(join(vaultDir, ".cohort", "encryption.yml"));
  const cfg = configText ? loadEncryptionFromText(configText) : { tool: "git-crypt" as const, encrypt: [] };
  const report = await checkHygiene(vaultDir, cfg, {
    gitattributes: await readOrEmpty(join(vaultDir, ".gitattributes")),
    gitignore: await readOrEmpty(join(vaultDir, ".gitignore")),
  });
  if (report.ok) {
    process.stdout.write("encryption hygiene ok: no key tracked, sensitive paths wired, key patterns ignored\n");
    return;
  }
  for (const p of report.problems) process.stdout.write(`problem: ${p}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "init") await runInit(rest);
  else if (command === "verify") await runVerify(rest);
  else if (command === "supersede") await runSupersede(rest);
  else if (command === "stats") await runStats(rest);
  else if (command === "index") await runIndex(rest);
  else if (command === "bridge") await runBridge(rest);
  else if (command === "reabsorb") await runReabsorb(rest);
  else if (command === "export") await runExport(rest);
  else if (command === "import") await runImport(rest);
  else if (command === "access") await runAccess(rest);
  else if (command === "encrypt-setup") await runEncryptSetup(rest);
  else if (command === "encrypt-check") await runEncryptCheck(rest);
  else {
    process.stdout.write(`${USAGE}\n`);
    process.exit(command ? 1 : 0);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`cohort: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
