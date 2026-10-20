#!/usr/bin/env node
import process from "node:process";

import { buildAudit } from "./audit.js";
import { type Authorizer, denyAll } from "./auth.js";
import { createDashboardServer } from "./server.js";
import { makeSsoAuthorizer } from "./sso.js";

/**
 * Entry point for the control-plane dashboard.
 *
 * The vault directory comes from COHORT_VAULT_DIR (read-only). The authorizer is
 * the SSO verifier when the signing material is configured in the environment,
 * and deny-all otherwise, so an unconfigured control plane serves nothing. The
 * signing material is read from the environment and is never logged. The server
 * never writes to the vault.
 */

function selectAuthorizer(env: Record<string, string | undefined>): Authorizer {
  const material = env.COHORT_CP_SSO_SIGNING;
  if (!material) return denyAll;
  const subjects = (env.COHORT_CP_SSO_SUBJECTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return makeSsoAuthorizer({ signingMaterial: material, allowedSubjects: subjects });
}

function main(): void {
  const env = process.env;
  const root = env.COHORT_VAULT_DIR ?? process.cwd();
  const port = Number(env.COHORT_CP_PORT ?? "8787");
  const server = createDashboardServer({ authorize: selectAuthorizer(env), audit: () => buildAudit(root) });
  server.listen(port, () => {
    process.stdout.write(`cohort control plane listening on :${port} (read-only; vault ${root})\n`);
  });
}

main();
