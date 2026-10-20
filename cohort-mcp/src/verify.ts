import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { listTracked, readVaultFile, stageAndCommit } from "./git.js";
import { parseRecord, serializeRecord } from "./record.js";

/**
 * cohort verify: human-only promotion of a record from quarantined to verified.
 *
 * This is deliberately not an MCP tool. The model can propose and read, but it
 * cannot promote: promotion is a human action run from the terminal, and the
 * verifying human is recorded (both as the git commit author and in the
 * record's verified-by field). A record can only become verified this way.
 */

const RECORD_DIRS = ["facts", "decisions", "threads"];

export interface VerifyResult {
  id: string;
  status: "verified" | "not-found" | "already-verified" | "error";
  path?: string;
  reason?: string;
}

/** Find the tracked record file whose id matches, or null. */
export async function findRecordPath(root: string, id: string): Promise<string | null> {
  const tracked = await listTracked(root, ".");
  for (const f of tracked) {
    if (!f.endsWith(".md") || !RECORD_DIRS.some((d) => f.startsWith(`${d}/`))) continue;
    try {
      if (parseRecord(await readVaultFile(root, f)).meta.id === id) return f;
    } catch {
      // skip unparseable files
    }
  }
  return null;
}

/** Promote the given records to verified, stamping the human's handle, then commit. */
export async function verifyRecords(
  root: string,
  ids: string[],
  verifiedBy: string,
  opts: { commit?: boolean } = {},
): Promise<VerifyResult[]> {
  const results: VerifyResult[] = [];
  const changed: string[] = [];
  for (const id of ids) {
    const path = await findRecordPath(root, id);
    if (!path) {
      results.push({ id, status: "not-found" });
      continue;
    }
    try {
      const record = parseRecord(await readVaultFile(root, path));
      if (record.meta.status === "verified") {
        results.push({ id, status: "already-verified", path });
        continue;
      }
      record.meta.status = "verified";
      record.meta.verified_by = verifiedBy;
      await writeFile(join(root, path), serializeRecord(record), "utf8");
      changed.push(path);
      results.push({ id, status: "verified", path });
    } catch (err) {
      results.push({ id, status: "error", reason: err instanceof Error ? err.message : String(err) });
    }
  }
  if ((opts.commit ?? true) && changed.length > 0) {
    await stageAndCommit(root, `memory: verify ${changed.length} record(s)`, changed);
  }
  return results;
}
