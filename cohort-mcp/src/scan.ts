import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Secret and PII scanning for the write gate.
 *
 * The default scanner shells out to gitleaks with the vault's own rules. If the
 * binary or the rules are missing, it throws ScannerUnavailable, and the gate
 * treats that as a hard refusal: never commit unscanned (fail closed). The
 * SecretScanner interface lets tests inject clean, dirty, and unavailable
 * scanners without the binary.
 */

export class ScannerUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScannerUnavailable";
  }
}

export interface ScanResult {
  clean: boolean;
  findings: string[];
}

export interface SecretScanner {
  scan(content: string): Promise<ScanResult>;
}

interface ExecOutcome {
  code: number;
  stdout: string;
  stderr: string;
}

function execOutcome(file: string, args: string[]): Promise<ExecOutcome> {
  return new Promise((resolveP, rejectP) => {
    execFile(file, args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && typeof (err as NodeJS.ErrnoException).code === "string" && (err as NodeJS.ErrnoException).code === "ENOENT") {
        rejectP(new ScannerUnavailable("gitleaks not found; install it to scan writes"));
        return;
      }
      const code = err && typeof err.code === "number" ? err.code : 0;
      resolveP({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/** A gitleaks-backed scanner using the vault's rules. Throws if it cannot run. */
export function makeGitleaksScanner(rulesPath: string): SecretScanner {
  return {
    async scan(content: string): Promise<ScanResult> {
      try {
        await access(rulesPath);
      } catch {
        throw new ScannerUnavailable(`redaction rules not found at ${rulesPath}`);
      }
      const dir = await mkdtemp(join(tmpdir(), "cohort-scan-"));
      const target = join(dir, "record.md");
      const report = join(dir, "report.json");
      try {
        await writeFile(target, content, "utf8");
        const outcome = await execOutcome("gitleaks", [
          "detect",
          "--no-git",
          "--source",
          dir,
          "--config",
          rulesPath,
          "--report-format",
          "json",
          "--report-path",
          report,
          "--redact",
          "--no-banner",
        ]);
        if (outcome.code === 0) return { clean: true, findings: [] };
        if (outcome.code === 1) {
          let findings: string[] = [];
          try {
            const parsed = JSON.parse(await readFile(report, "utf8")) as Array<{ RuleID?: string }>;
            findings = parsed.map((f) => f.RuleID ?? "secret").filter((v, i, a) => a.indexOf(v) === i);
          } catch {
            findings = ["secret"];
          }
          return { clean: false, findings };
        }
        throw new ScannerUnavailable(`gitleaks exited ${outcome.code}: ${outcome.stderr.trim()}`);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
