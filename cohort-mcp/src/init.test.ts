import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  PINNED_SPEC,
  claudeCodeAddArgs,
  installSkillFallback,
  mergeDesktopConfig,
  seedPolicy,
  serverEntry,
  starterPolicyYaml,
  writeDesktopConfig,
} from "./init.js";
import { loadPolicyFromText } from "./policy.js";

const opts = { vaultDir: "/home/me/vault", agentId: "claude-code@alice" };

test("the registration spec is pinned, not floating", () => {
  assert.match(PINNED_SPEC, /^cohort-mcp@\d+\.\d+\.\d+/);
});

test("claude mcp add args are an argv array carrying the pinned spec and identity", () => {
  const args = claudeCodeAddArgs(opts);
  assert.deepEqual(args.slice(0, 5), ["mcp", "add", "cohort", "--scope", "user"]);
  assert.ok(args.includes("COHORT_AGENT_ID=claude-code@alice"));
  assert.ok(args.includes("COHORT_VAULT_DIR=/home/me/vault"));
  assert.equal(args[args.length - 1], PINNED_SPEC);
  assert.ok(!args.some((a) => a.includes(" -- ")), "no element bundles a shell string");
});

test("serverEntry pins the spec and carries the identity", () => {
  const entry = serverEntry(opts);
  assert.deepEqual(entry.args, ["-y", PINNED_SPEC]);
  assert.equal(entry.env.COHORT_AGENT_ID, "claude-code@alice");
});

test("mergeDesktopConfig preserves other servers and is idempotent", () => {
  const existing = { mcpServers: { other: { command: "x", args: [], env: {} } } };
  const once = mergeDesktopConfig(existing, serverEntry(opts));
  const twice = mergeDesktopConfig(once, serverEntry(opts));
  assert.deepEqual(once, twice);
  const servers = once.mcpServers as Record<string, unknown>;
  assert.ok("other" in servers, "existing server preserved");
  assert.ok("cohort" in servers, "cohort added");
});

test("writeDesktopConfig writes, preserves, and is idempotent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cohort-init-"));
  const path = join(dir, "claude_desktop_config.json");
  await writeFile(path, JSON.stringify({ mcpServers: { other: { command: "x", args: [], env: {} } } }));
  await writeDesktopConfig(path, serverEntry(opts));
  const first = await readFile(path, "utf8");
  await writeDesktopConfig(path, serverEntry(opts));
  const second = await readFile(path, "utf8");
  assert.equal(first, second, "re-running is idempotent");
  const parsed = JSON.parse(second) as { mcpServers: Record<string, { args: string[] }> };
  assert.ok(parsed.mcpServers.other, "other server preserved");
  assert.ok(parsed.mcpServers.cohort?.args.includes(PINNED_SPEC));
});

test("seedPolicy writes a valid policy once and never clobbers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cohort-init-"));
  assert.equal(await seedPolicy(dir), true);
  assert.equal(await seedPolicy(dir), false, "does not clobber an existing policy");
  const loaded = loadPolicyFromText(starterPolicyYaml());
  assert.equal(loaded.degraded, false, "the seeded policy is valid");
  assert.equal(loaded.policy.classes["secret-or-credential"]?.propose, "never");
});

test("installSkillFallback copies the SKILL.md", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cohort-init-"));
  const src = join(dir, "SKILL.md");
  await writeFile(src, "# a connector skill\n");
  const dest = await installSkillFallback(src, join(dir, "skills", "cohort"));
  assert.match(await readFile(dest, "utf8"), /a connector skill/);
});
