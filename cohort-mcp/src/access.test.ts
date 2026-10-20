import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { loadAccess, loadAccessFromText, resolveAccess } from "./access.js";

const CONFIG = `
version: 1
vaults:
  eng:
    readable: ["facts/**", "decisions/**"]
    writable: ["facts/**"]
    deny: ["**/*secret*"]
  sec:
    readable: ["facts/**"]
    writable: []
agents:
  "claude-code@alice":
    eng: { read: ["**"], write: ["facts/**"] }
    sec: { read: ["facts/public/**"] }
  "*":
    eng: { read: ["facts/public/**"] }
`;

test("an explicit grant allows read and write within scope", () => {
  const cfg = loadAccessFromText(CONFIG);
  assert.equal(resolveAccess(cfg, { vaultId: "eng", agentId: "claude-code@alice", path: "facts/a.md" }).allowed, true);
  assert.equal(
    resolveAccess(cfg, { vaultId: "eng", agentId: "claude-code@alice", path: "facts/a.md", write: true }).allowed,
    true,
  );
});

test("a vault deny overrides a broad grant", () => {
  const cfg = loadAccessFromText(CONFIG);
  const d = resolveAccess(cfg, { vaultId: "eng", agentId: "claude-code@alice", path: "facts/mysecret.md" });
  assert.equal(d.allowed, false);
  assert.match(d.reason, /denied by vault/);
});

test("write outside the vault writable cap is denied", () => {
  const cfg = loadAccessFromText(CONFIG);
  const d = resolveAccess(cfg, { vaultId: "eng", agentId: "claude-code@alice", path: "decisions/a.md", write: true });
  assert.equal(d.allowed, false);
  assert.match(d.reason, /writable scope/);
});

test("the sec vault grants no write at all", () => {
  const cfg = loadAccessFromText(CONFIG);
  assert.equal(resolveAccess(cfg, { vaultId: "sec", agentId: "claude-code@alice", path: "facts/x.md", write: true }).allowed, false);
  assert.equal(resolveAccess(cfg, { vaultId: "sec", agentId: "claude-code@alice", path: "facts/public/x.md" }).allowed, true);
  assert.equal(resolveAccess(cfg, { vaultId: "sec", agentId: "claude-code@alice", path: "facts/private/x.md" }).allowed, false);
});

test("an unlisted agent falls back to the wildcard grant", () => {
  const cfg = loadAccessFromText(CONFIG);
  assert.equal(resolveAccess(cfg, { vaultId: "eng", agentId: "claude-code@carol", path: "facts/public/x.md" }).allowed, true);
  assert.equal(resolveAccess(cfg, { vaultId: "eng", agentId: "claude-code@carol", path: "facts/private/x.md" }).allowed, false);
});

test("least privilege: unknown vault, no identity, and no grant all deny", () => {
  const cfg = loadAccessFromText(CONFIG);
  assert.equal(resolveAccess(cfg, { vaultId: "ghost", agentId: "claude-code@alice", path: "facts/a.md" }).allowed, false);
  assert.equal(resolveAccess(cfg, { vaultId: "sec", agentId: null, path: "facts/public/x.md" }).allowed, false);
  // alice is listed but has no grant on a vault she is not mapped to
  const two = loadAccessFromText(`
vaults: { eng: {}, ops: {} }
agents: { "claude-code@alice": { eng: { read: ["**"] } } }
`);
  assert.equal(resolveAccess(two, { vaultId: "ops", agentId: "claude-code@alice", path: "facts/a.md" }).allowed, false);
});

test("loadAccess fails closed to deny-all on a missing or invalid file", async () => {
  const miss = await loadAccess(join(tmpdir(), "does-not-exist-cohort-access.yml"));
  assert.equal(miss.degraded, true);
  assert.equal(resolveAccess(miss.config, { vaultId: "eng", agentId: "claude-code@alice", path: "facts/a.md" }).allowed, false);

  const dir = await mkdtemp(join(tmpdir(), "cohort-access-"));
  const bad = join(dir, "access.yml");
  await writeFile(bad, "vaults: : : not yaml");
  const loaded = await loadAccess(bad);
  assert.equal(loaded.degraded, true);
});
