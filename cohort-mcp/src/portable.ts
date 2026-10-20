import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { listTracked, readVaultFile } from "./git.js";
import { type Kind, type VaultRecord, parseRecord, serializeRecord } from "./record.js";

/**
 * Export and import a portable vault.
 *
 * Unlike the bridge files (a readable, lossy rendering of verified memory), the
 * portable format is a lossless JSON document carrying every record with all
 * its fields, on a common schema other tools can read. Export then import
 * reconstructs the records exactly. Import writes files but does not commit;
 * the human reviews and commits, so an import is never a silent write.
 */

const RECORD_DIRS = ["facts", "decisions", "threads"];
const DIR_FOR: Record<Kind, string> = { fact: "facts", decision: "decisions", thread: "threads" };

export const PORTABLE_VERSION = "1";

export interface PortableVault {
  version: string;
  records: VaultRecord[];
}

/** Collect every record in the vault into a deterministic portable document. */
export async function exportVault(root: string): Promise<PortableVault> {
  const tracked = await listTracked(root, ".");
  const files = tracked.filter((f) => f.endsWith(".md") && RECORD_DIRS.some((d) => f.startsWith(`${d}/`)));
  const records: VaultRecord[] = [];
  for (const f of files) {
    try {
      records.push(parseRecord(await readVaultFile(root, f)));
    } catch {
      // skip unreadable
    }
  }
  records.sort((a, b) => (a.meta.id < b.meta.id ? -1 : a.meta.id > b.meta.id ? 1 : 0));
  return { version: PORTABLE_VERSION, records };
}

export function serializePortable(pv: PortableVault): string {
  return `${JSON.stringify(pv, null, 2)}\n`;
}

/** Parse and validate a portable document. Each record is normalized through the record schema. */
export function parsePortable(json: string): PortableVault {
  const raw = JSON.parse(json) as { version?: unknown; records?: unknown };
  if (raw.version !== PORTABLE_VERSION) {
    throw new Error(`unsupported portable vault version: ${String(raw.version)}`);
  }
  if (!Array.isArray(raw.records)) {
    throw new Error("portable vault: records must be an array");
  }
  const records = raw.records.map((r) => parseRecord(serializeRecord(r as VaultRecord)));
  return { version: PORTABLE_VERSION, records };
}

/** Write a portable document's records into a vault, at their canonical paths. Does not commit. */
export async function importVault(root: string, pv: PortableVault): Promise<string[]> {
  const written: string[] = [];
  for (const record of pv.records) {
    const path = `${DIR_FOR[record.meta.kind]}/${record.meta.id}.md`;
    const abs = join(root, path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, serializeRecord(record), "utf8");
    written.push(path);
  }
  return written;
}
