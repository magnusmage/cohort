#!/usr/bin/env node
import process from "node:process";

import { buildAudit } from "./audit.js";
import { type Authorizer, denyAll } from "./auth.js";
import { createDashboardServer } from "./server.js";

/**
 * Entry point for the control-plane dashboard.
 *
 * The vault directory comes from COHORT_VAULT_DIR (read-only). The authorizer
 * defaults to deny-all; a real single sign-on authorizer is selected when the
 * identity provider is configured in the environment. The server never writes
 * to the vault.
 */

function selectAuthorizer(): Authorizer {
  // SSO wiring is added in sso.ts. Until it is configured, fail closed.
  return denyAll;
}

function main(): void {
  const env = process.env;
  const root = env.COHORT_VAULT_DIR ?? process.cwd();
  const port = Number(env.COHORT_CP_PORT ?? "8787");
  const server = createDashboardServer({ authorize: selectAuthorizer(), audit: () => buildAudit(root) });
  server.listen(port, () => {
    process.stdout.write(`cohort control plane listening on :${port} (read-only; vault ${root})\n`);
  });
}

main();
