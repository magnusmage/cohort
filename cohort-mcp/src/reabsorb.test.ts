import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { git, revParse } from "./git.js";
import { loadPolicyFromText } from "./policy.js";
import { createRecord, serializeRecord } from "./record.js";
import { parseBridgeItems, reabsorb } from "./reabsorb.js";
import type { ScanResult, SecretScanner } from "./scan.js";

const source = { agent: "claude-code@alice", model: "claude-opus-4-8", commit: "a1b2c3d" };
const AGENT = "claude-code@bob";
const clean = { scan: async (): Promise<ScanResult> => ({ clean: true, findings: [] }) } satisfies SecretScanner;
const dirty = { scan: async (): Promise<ScanResult> => ({ clean: false, findings: ["aws-access-key"] }) } satisfies SecretScanner;
const POLICY = loadPolicyFromText(`
defaults: { load: ask, propose: ask, on_write: pull_request }
paths:
  readable: ["facts/**", "decisions/**"]
  writable: ["facts/**", "decisions/**"]
  deny: []
`);

const MARKER = "<!-- cohort:generated -->";

async function vaultWithVerified(text: string): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "cohort-reabsorb-"));
  const root = join(base, "work");
  await git(["init", root]);
  await git(["-C", root, "symbolic-ref", "HEAD", "refs/heads/main"]);
  await git(["-C", root, "config", "user.name", "T"]);
  await git(["-C", root, "config", "user.email", "t@e.com"]);
  const rec = createRecord({ kind: "decision", text, source });
  rec.meta.status = "verified";
  rec.meta.verified_by = "alice";
  await mkdir(join(root, "decisions"), { recursive: true });
  await writeFile(join(root, "decisions", "d.md"), serializeRecord(rec));
  await git(["-C", root, "add", "-A"]);
  await git(["-C", root, "commit", "-m", "seed"]);
  return root;
}

test("parseBridgeItems reads bullets back into classified items", () => {
  const items = parseBridgeItems(
    `# Team memory\n\n${MARKER}\n\n## Decisions\n\n- Adopt Postgres.\n\n## Open threads\n\n- Migrate billing.\n`,
  );
  assert.deepEqual(
    items.map((i) => [i.kind, i.text]),
    [
      ["decision", "Adopt Postgres."],
      ["thread", "Migrate billing."],
    ],
  );
});

test("reabsorb proposes only the new bullet, through the gate, nothing auto-landed", async () => {
  const existing = "Adopt Postgres for the primary store.";
  const root = await vaultWithVerified(existing);
  const before = await revParse(root, "main");
  const edited = `# Team memory\n\n${MARKER}\n\n## Decisions\n\n- ${existing}\n- Use feature flags for risky changes.\n`;

  const { newItems, results } = await reabsorb(root, POLICY, AGENT, edited, { scanner: clean });
  assert.equal(newItems.length, 1, "the already-present bullet is not re-proposed");
  assert.equal(newItems[0]?.text, "Use feature flags for risky changes.");
  assert.equal(results[0]?.decision, "pending", "a new edit is held for approval, not written back");
  assert.equal(await revParse(root, "main"), before);
});

test("a hand-edited bullet carrying a secret is rejected by the gate", async () => {
  const root = await vaultWithVerified("Adopt Postgres.");
  const edited = `# Team memory\n\n${MARKER}\n\n## Conventions and facts\n\n- here is a pasted secret value\n`;
  const { results } = await reabsorb(root, POLICY, AGENT, edited, { scanner: dirty });
  assert.equal(results[0]?.decision, "rejected");
  assert.match(results[0]?.reason ?? "", /secret or PII/);
});
