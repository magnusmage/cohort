import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { readVaultFile, stageAndCommit } from "./git.js";
import { parseRecord, serializeRecord } from "./record.js";
import { findRecordPath } from "./verify.js";

/**
 * cohort supersede: a human marks one record as replaced by another.
 *
 * Like verify, this is a terminal command, not an MCP tool: the model can
 * propose and read, but only a human supersedes. The old record keeps its file
 * and stays in git history; it is marked superseded so it drops out of load,
 * and the new record records which id it replaces. The human running the
 * command is the git commit author, so the act is attributable.
 */

export interface SupersedeResult {
  oldId: string;
  newId: string;
  status: "superseded" | "not-found" | "error";
  reason?: string;
}

/** Mark oldId superseded and point newId at it, then commit. Both records must exist. */
export async function supersedeRecord(
  root: string,
  oldId: string,
  newId: string,
  opts: { commit?: boolean } = {},
): Promise<SupersedeResult> {
  if (oldId === newId) {
    return { oldId, newId, status: "error", reason: "a record cannot supersede itself" };
  }
  const oldPath = await findRecordPath(root, oldId);
  const newPath = await findRecordPath(root, newId);
  if (!oldPath || !newPath) {
    return { oldId, newId, status: "not-found", reason: !oldPath ? `no record ${oldId}` : `no record ${newId}` };
  }
  try {
    const oldRecord = parseRecord(await readVaultFile(root, oldPath));
    const newRecord = parseRecord(await readVaultFile(root, newPath));
    oldRecord.meta.status = "superseded";
    newRecord.meta.supersedes = oldId;
    await writeFile(join(root, oldPath), serializeRecord(oldRecord), "utf8");
    await writeFile(join(root, newPath), serializeRecord(newRecord), "utf8");
    if (opts.commit ?? true) {
      await stageAndCommit(root, `memory: supersede ${oldId} with ${newId}`, [oldPath, newPath]);
    }
    return { oldId, newId, status: "superseded" };
  } catch (err) {
    return { oldId, newId, status: "error", reason: err instanceof Error ? err.message : String(err) };
  }
}
