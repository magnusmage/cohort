import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import process from "node:process";
import { test } from "node:test";

import { ScannerUnavailable, makeGitleaksScanner } from "./scan.js";

function hasGitleaks(): Promise<boolean> {
  return new Promise((res) => execFile("gitleaks", ["version"], (err) => res(!err)));
}
const gitleaksAvailable = await hasGitleaks();

test("fails closed when the rules file is missing", async () => {
  const scanner = makeGitleaksScanner("/does/not/exist/redaction-rules.toml");
  await assert.rejects(() => scanner.scan("anything"), ScannerUnavailable);
});

test(
  "real gitleaks flags a planted secret and passes clean content",
  { skip: gitleaksAvailable ? false : "gitleaks not installed" },
  async () => {
    const rules = join(process.cwd(), "..", "security", "redaction-rules.toml");
    const scanner = makeGitleaksScanner(rules);
    // A fake AWS key for the scanner to catch. Allowlisted so the repo's own
    // redaction scan ignores this one source line; the scanner still sees the raw value.
    const plantedKey = "AKIAIOSFODNN7EXAMPLE wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"; // gitleaks:allow
    const dirty = await scanner.scan(plantedKey);
    assert.equal(dirty.clean, false);
    const clean = await scanner.scan("Team uses Postgres and TypeScript. Nothing secret here.");
    assert.equal(clean.clean, true);
  },
);
