import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  buildPolicyView,
  loadPolicy,
  loadPolicyFromText,
  resolveEffective,
} from "./policy.js";

const VALID = `
defaults:
  load: ask
  propose: ask
  on_write: pull_request
classes:
  coding-convention: { propose: auto }
  secret-or-credential: { propose: never }
paths:
  readable: ["facts/**"]
  writable: ["facts/**"]
  deny: ["**/.env"]
agents:
  ci-bot: { load: auto, propose: never }
  "claude-code@alice": { load: auto, propose: ask }
`;

const AUTO_DEFAULTS = `
defaults:
  load: auto
  propose: auto
  on_write: direct_commit
`;

test("valid policy loads and is not degraded", () => {
  const loaded = loadPolicyFromText(VALID);
  assert.equal(loaded.degraded, false);
  assert.equal(loaded.policy.defaults.propose, "ask");
});

test("a configured class resolves to its autonomy for a trusted agent", () => {
  const { policy } = loadPolicyFromText(VALID);
  const eff = resolveEffective(policy, { className: "coding-convention", agentId: "claude-code@bob" });
  assert.equal(eff.propose, "auto");
});

test("an agent rule overrides a class, and never cannot be upgraded", () => {
  const { policy } = loadPolicyFromText(VALID);
  // ci-bot propose never beats coding-convention auto.
  assert.equal(resolveEffective(policy, { className: "coding-convention", agentId: "ci-bot" }).propose, "never");
  // The file's never class stays never for any agent.
  assert.equal(resolveEffective(policy, { className: "secret-or-credential", agentId: "ci-bot" }).propose, "never");
});

test("hard never-classes resolve to never even when absent from the file", () => {
  const { policy } = loadPolicyFromText(VALID);
  assert.equal(resolveEffective(policy, { className: "customer-pii", agentId: "claude-code@alice" }).propose, "never");
});

test("an unknown class and an untrusted identity never resolve to auto", () => {
  const { policy } = loadPolicyFromText(AUTO_DEFAULTS);
  // Unknown class caps off auto even though the default is auto.
  assert.equal(resolveEffective(policy, { className: "made-up", agentId: "claude-code@bob" }).propose, "ask");
  // No agent identity means the most restrictive outcome.
  const untrusted = resolveEffective(policy, { agentId: null });
  assert.equal(untrusted.propose, "ask");
  assert.equal(untrusted.load, "ask");
});

test("load: manual is preserved", () => {
  const { policy } = loadPolicyFromText("defaults:\n  load: manual\n  propose: ask\n  on_write: pull_request\n");
  assert.equal(resolveEffective(policy, { agentId: "claude-code@alice" }).load, "manual");
});

test("malformed or invalid policy fails closed", () => {
  const bad = loadPolicyFromText("defaults: : : not yaml\n");
  assert.equal(bad.degraded, true);
  assert.equal(bad.policy.defaults.propose, "ask");
  assert.deepEqual(bad.policy.paths.deny, ["**"]);

  const missingDefaults = loadPolicyFromText("classes: {}\n");
  assert.equal(missingDefaults.degraded, true);
});

test("loadPolicy fails closed when policy.yml is missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cohort-policy-"));
  const loaded = await loadPolicy(dir);
  assert.equal(loaded.degraded, true);
  assert.match(loaded.reason ?? "", /missing/);
});

test("loadPolicy reads a real vault policy", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cohort-policy-"));
  await mkdir(join(dir, ".cohort"), { recursive: true });
  await writeFile(join(dir, ".cohort", "policy.yml"), VALID);
  const loaded = await loadPolicy(dir);
  assert.equal(loaded.degraded, false);
  const view = buildPolicyView(loaded, "claude-code@alice");
  assert.equal(view.agent, "claude-code@alice");
  assert.equal(view.effective.load, "auto");
  assert.ok(view.classes.includes("coding-convention"));
  assert.deepEqual(view.paths.deny, ["**/.env"]);
});
