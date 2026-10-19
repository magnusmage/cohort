import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  type PrOpener,
  createBranch,
  git,
  landWrite,
  listTracked,
  readVaultFile,
  revParse,
  sanitizeRefSegment,
  stageAndCommit,
  uniqueBranchName,
  vaultRoot,
} from "./git.js";

/** A bare remote plus a configured working clone with one seed commit on main. */
async function setupRepo(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "cohort-git-"));
  const remote = join(base, "remote.git");
  const work = join(base, "work");
  await git(["init", "--bare", remote]);
  await git(["clone", remote, work]);
  // Name the unborn branch main without git init -b (keeps old git happy).
  await git(["-C", work, "symbolic-ref", "HEAD", "refs/heads/main"]);
  await git(["-C", work, "config", "user.name", "Test"]);
  await git(["-C", work, "config", "user.email", "test@example.com"]);
  await git(["-C", work, "config", "commit.gpgsign", "false"]);
  await mkdir(join(work, "facts"), { recursive: true });
  await writeFile(join(work, "facts", "seed.md"), "# seed\n");
  await git(["-C", work, "add", "-A"]);
  await git(["-C", work, "commit", "-m", "init"]);
  await git(["-C", work, "push", "-u", "origin", "main"]);
  return work;
}

test("vaultRoot resolves and readVaultFile refuses escape", async () => {
  const root = await setupRepo();
  assert.equal(await vaultRoot(root), root);
  assert.match(await readVaultFile(root, "facts/seed.md"), /# seed/);
  await assert.rejects(() => readVaultFile(root, "../outside.md"), /escapes the vault/);
});

test("listTracked returns tracked files", async () => {
  const root = await setupRepo();
  assert.deepEqual(await listTracked(root, "facts"), ["facts/seed.md"]);
});

test("pull_request write branches and never touches the default branch", async () => {
  const root = await setupRepo();
  const mainBefore = await revParse(root, "main");

  const calls: Array<{ base: string; head: string }> = [];
  const fakeOpener: PrOpener = async ({ base, head }) => {
    calls.push({ base, head });
    return "https://example.test/pr/1";
  };

  await writeFile(join(root, "facts", "new.md"), "# new fact\n");
  const result = await landWrite(
    root,
    { onWrite: "pull_request", message: "feat: add a fact", paths: ["facts/new.md"], label: "add-fact" },
    { prOpener: fakeOpener },
  );

  assert.equal(result.mode, "pull_request");
  assert.equal(result.prUrl, "https://example.test/pr/1");
  assert.match(result.branch, /^cohort\/add-fact-/);
  assert.equal(await revParse(root, "main"), mainBefore, "default branch must be unchanged");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.base, "main");
  assert.equal(calls[0]?.head, result.branch);

  const body = await git(["-C", root, "log", "-1", "--format=%B", result.branch]);
  assert.match(body, /Signed-off-by:/, "commit must carry a DCO sign-off");
});

test("direct_commit advances the default branch", async () => {
  const root = await setupRepo();
  const mainBefore = await revParse(root, "main");
  await writeFile(join(root, "facts", "direct.md"), "# direct\n");
  const result = await landWrite(root, {
    onWrite: "direct_commit",
    message: "feat: direct fact",
    paths: ["facts/direct.md"],
  });
  assert.equal(result.mode, "direct_commit");
  assert.equal(result.branch, "main");
  assert.notEqual(await revParse(root, "main"), mainBefore, "main should advance");
});

test("hostile filename is handled literally (argv, not a shell)", async () => {
  const root = await setupRepo();
  const hostile = "facts/weird ; rm -rf x.md";
  await writeFile(join(root, hostile), "safe\n");
  await createBranch(root, uniqueBranchName("hostile"));
  await stageAndCommit(root, "test: commit a hostile filename", [hostile]);
  const tracked = await listTracked(root, "facts");
  assert.ok(tracked.includes(hostile), "the literal filename should be committed, nothing executed");
});

test("sanitizeRefSegment cleans and rejects", () => {
  assert.equal(sanitizeRefSegment("feat: add #1!"), "feat-add-1");
  assert.equal(sanitizeRefSegment("a..b"), "a-b");
  assert.throws(() => sanitizeRefSegment("..."), /safe ref segment/);
  assert.throws(() => sanitizeRefSegment(""), /safe ref segment/);
});
