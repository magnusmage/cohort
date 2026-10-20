import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  SENSITIVE_FILE_GLOBS,
  checkHygiene,
  gitattributesBlock,
  gitignoreBlock,
  loadEncryptionFromText,
  upsertBlock,
} from "./encryption.js";
import { git } from "./git.js";

const CONFIG = `
version: 1
tool: git-crypt
encrypt: ["facts/private/**", "**/*.secret.md"]
`;

test("loadEncryptionFromText parses tool and globs, rejects a bad tool", () => {
  const cfg = loadEncryptionFromText(CONFIG);
  assert.equal(cfg.tool, "git-crypt");
  assert.deepEqual(cfg.encrypt, ["facts/private/**", "**/*.secret.md"]);
  assert.throws(() => loadEncryptionFromText("tool: rot13\nencrypt: []"), /invalid encryption config/);
});

test("gitattributesBlock routes each glob through the filter", () => {
  const block = gitattributesBlock(loadEncryptionFromText(CONFIG));
  assert.match(block, /facts\/private\/\*\* filter=git-crypt diff=git-crypt/);
  assert.match(block, /\*\*\/\*\.secret\.md filter=git-crypt diff=git-crypt/);
  const age = gitattributesBlock(loadEncryptionFromText("tool: age\nencrypt: ['x/**']"));
  assert.match(age, /x\/\*\* filter=age diff=age/);
});

test("gitignoreBlock lists every key pattern", () => {
  const block = gitignoreBlock();
  for (const pat of SENSITIVE_FILE_GLOBS) assert.ok(block.includes(pat), `missing ${pat}`);
});

test("upsertBlock inserts once and then replaces in place", () => {
  const one = upsertBlock("existing\n", gitignoreBlock());
  assert.ok(one.startsWith("existing\n"));
  const two = upsertBlock(one, gitattributesBlock(loadEncryptionFromText(CONFIG)));
  // The old generated block is replaced, not duplicated.
  assert.equal(two.match(/cohort:encryption \(generated\)/g)?.length, 1);
  assert.ok(two.startsWith("existing\n"));
});

async function vault(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "cohort-enc-"));
  const root = join(base, "work");
  await git(["init", root]);
  await git(["-C", root, "symbolic-ref", "HEAD", "refs/heads/main"]);
  await git(["-C", root, "config", "user.name", "T"]);
  await git(["-C", root, "config", "user.email", "t@e.com"]);
  return root;
}

test("checkHygiene passes when wiring is in place and no key is tracked", async () => {
  const root = await vault();
  const cfg = loadEncryptionFromText(CONFIG);
  const report = await checkHygiene(root, cfg, { gitattributes: gitattributesBlock(cfg), gitignore: gitignoreBlock() });
  assert.equal(report.ok, true, report.problems.join("; "));
});

test("checkHygiene fails closed when a key is tracked in git", async () => {
  const root = await vault();
  await mkdir(join(root, ".cohort", "keys"), { recursive: true });
  await writeFile(join(root, ".cohort", "keys", "git-crypt-key"), "KEYBYTES"); // a key wrongly committed
  await git(["-C", root, "add", "-A"]);
  await git(["-C", root, "commit", "-m", "oops"]);
  const cfg = loadEncryptionFromText(CONFIG);
  const report = await checkHygiene(root, cfg, { gitattributes: gitattributesBlock(cfg), gitignore: gitignoreBlock() });
  assert.equal(report.ok, false);
  assert.ok(report.problems.some((p) => /key file is tracked/.test(p)));
});

test("checkHygiene flags a sensitive path that is not wired or a missing ignore", async () => {
  const root = await vault();
  const cfg = loadEncryptionFromText(CONFIG);
  const report = await checkHygiene(root, cfg, { gitattributes: "", gitignore: "" });
  assert.equal(report.ok, false);
  assert.ok(report.problems.some((p) => /not wired into \.gitattributes/.test(p)));
  assert.ok(report.problems.some((p) => /not in \.gitignore/.test(p)));
});
