import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { cwd } from "node:process";
import { test } from "node:test";

/**
 * Open-core boundary enforcement.
 *
 * The vault, the CLI, and the cohort-mcp server stay Apache-2.0 and must never
 * depend on a commercial control-plane component. This test fails the build if
 * an open-core source file imports from a commercial namespace, and asserts the
 * package license stays Apache-2.0. The boundary is documented in
 * docs/OPEN-CORE.md; this keeps it true.
 */

// Import specifiers that would mean an open-core file reached into the paid layer.
const FORBIDDEN = [/control-plane/i, /\benterprise\b/i, /dashboard/i, /\bsso\b/i, /@cohort\/(enterprise|cloud|paid)/i];

const IMPORT_RE = /(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]|\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;

test("package is licensed Apache-2.0", async () => {
  const pkg = JSON.parse(await readFile(join(cwd(), "package.json"), "utf8")) as { license?: string };
  assert.equal(pkg.license, "Apache-2.0");
});

test("no open-core source imports a commercial component", async () => {
  const srcDir = join(cwd(), "src");
  const files = (await readdir(srcDir)).filter((f) => f.endsWith(".ts"));
  assert.ok(files.length > 0, "expected source files to scan");
  const offenders: string[] = [];
  for (const file of files) {
    const text = await readFile(join(srcDir, file), "utf8");
    for (const match of text.matchAll(IMPORT_RE)) {
      const spec = match[1] ?? match[2] ?? "";
      if (FORBIDDEN.some((re) => re.test(spec))) offenders.push(`${file}: ${spec}`);
    }
  }
  assert.deepEqual(offenders, [], `open-core files must not import a commercial component: ${offenders.join(", ")}`);
});
