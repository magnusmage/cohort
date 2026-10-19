import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile as fsReadFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

/**
 * Vault git transport.
 *
 * Every external process is launched with an argument array through execFile,
 * never a shell. No record field, topic, path, or other caller value is ever
 * interpolated into a command string, so there is no command or argument
 * injection surface here. Branch names derived from caller values go through
 * sanitizeRefSegment first.
 */

export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitError";
  }
}

const MAX_BUFFER = 16 * 1024 * 1024;

/** Run a program with an argv array. No shell, so values are passed literally. */
function run(file: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolveP, rejectP) => {
    execFile(file, args, { cwd, maxBuffer: MAX_BUFFER }, (err, stdout, stderr) => {
      if (err) {
        const detail = String(stderr).trim() || err.message;
        rejectP(new GitError(`${file} ${args.join(" ")}: ${detail}`));
      } else {
        resolveP(String(stdout));
      }
    });
  });
}

/** Run git and return trimmed stdout. */
export async function git(args: string[], cwd?: string): Promise<string> {
  return (await run("git", args, cwd)).trim();
}

/**
 * Reduce a caller-supplied label to a safe single git ref segment.
 * Throws if nothing usable remains, so a hostile label cannot become an empty
 * or malformed ref.
 */
export function sanitizeRefSegment(input: string): string {
  const cleaned = input
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  if (!cleaned || cleaned === "@") {
    throw new GitError(`cannot derive a safe ref segment from ${JSON.stringify(input)}`);
  }
  return cleaned;
}

/** A unique, collision-resistant branch name for one writeback. */
export function uniqueBranchName(label = "writeback"): string {
  const seg = sanitizeRefSegment(label);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "-").replace("Z", "");
  const rand = randomBytes(3).toString("hex");
  return `cohort/${seg}-${stamp}-${rand}`;
}

/** Resolve the vault's own git root. */
export async function vaultRoot(cwd: string): Promise<string> {
  return resolve(await git(["-C", cwd, "rev-parse", "--show-toplevel"]));
}

/** Read a file inside the vault. Rejects a path that escapes the root. */
export async function readVaultFile(root: string, relPath: string): Promise<string> {
  const abs = resolve(root, relPath);
  const rel = relative(root, abs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new GitError(`path escapes the vault: ${relPath}`);
  }
  return fsReadFile(abs, "utf8");
}

/** List tracked files under a pathspec. */
export async function listTracked(root: string, pathspec = "."): Promise<string[]> {
  const out = await git(["-C", root, "ls-files", "--", pathspec]);
  return out ? out.split("\n").filter(Boolean) : [];
}

/** Stage the given paths and commit with DCO sign-off. Returns the commit sha. */
export async function stageAndCommit(root: string, message: string, paths: string[]): Promise<string> {
  if (paths.length === 0) throw new GitError("refusing to commit with no paths");
  await git(["-C", root, "add", "--", ...paths]);
  await git(["-C", root, "commit", "-s", "-m", message]);
  return git(["-C", root, "rev-parse", "HEAD"]);
}

export async function currentBranch(root: string): Promise<string> {
  return git(["-C", root, "rev-parse", "--abbrev-ref", "HEAD"]);
}

export async function revParse(root: string, ref: string): Promise<string> {
  return git(["-C", root, "rev-parse", ref]);
}

/** The vault's default branch, or "main" when it cannot be resolved. */
export async function defaultBranch(root: string): Promise<string> {
  try {
    const ref = await git(["-C", root, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
    return ref.replace(/^origin\//, "");
  } catch {
    return "main";
  }
}

export async function createBranch(root: string, name: string): Promise<void> {
  // checkout -b works on every git; switch is newer and the project targets old git.
  await git(["-C", root, "checkout", "-b", name]);
}

export async function push(root: string, branch: string, setUpstream = false): Promise<void> {
  const args = ["-C", root, "push"];
  if (setUpstream) args.push("-u");
  args.push("origin", branch);
  await git(args);
}

/** Open a pull request. Injectable so the orchestrator is testable without GitHub. */
export type PrOpener = (p: {
  root: string;
  base: string;
  head: string;
  title: string;
  body: string;
}) => Promise<string>;

/** Default opener: gh pr create with an argv array (no shell). Returns the PR URL. */
export const ghPrOpener: PrOpener = async ({ root, base, head, title, body }) =>
  (await run("gh", ["pr", "create", "--base", base, "--head", head, "--title", title, "--body", body], root)).trim();

export interface WriteRequest {
  onWrite: "direct_commit" | "pull_request";
  message: string;
  paths: string[];
  label?: string;
  title?: string;
  body?: string;
}

export interface WriteResult {
  mode: "direct_commit" | "pull_request";
  commit: string;
  branch: string;
  prUrl?: string;
}

/**
 * Land a write per the on_write mode.
 *
 * pull_request always creates a fresh branch and commits there, so a
 * pull_request write can never land on the default branch directly. The policy
 * decision of which mode to use lives in the write gate (a later ticket); this
 * module only carries it out.
 */
export async function landWrite(
  root: string,
  req: WriteRequest,
  opts: { prOpener?: PrOpener } = {},
): Promise<WriteResult> {
  const base = await defaultBranch(root);

  if (req.onWrite === "direct_commit") {
    if ((await currentBranch(root)) !== base) {
      await git(["-C", root, "checkout", base]);
    }
    try {
      await git(["-C", root, "pull", "--rebase"]);
    } catch {
      // Best-effort: offline or no upstream yet. The commit and push still run.
    }
    const commit = await stageAndCommit(root, req.message, req.paths);
    await push(root, base);
    return { mode: "direct_commit", commit, branch: base };
  }

  const branch = uniqueBranchName(req.label ?? "writeback");
  await createBranch(root, branch);
  const commit = await stageAndCommit(root, req.message, req.paths);
  await push(root, branch, true);
  const opener = opts.prOpener ?? ghPrOpener;
  const prUrl = await opener({
    root,
    base,
    head: branch,
    title: req.title ?? req.message.split("\n", 1)[0] ?? req.message,
    body: req.body ?? "",
  });
  return { mode: "pull_request", commit, branch, prUrl };
}
