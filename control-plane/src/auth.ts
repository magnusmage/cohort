/**
 * The control plane's authentication boundary.
 *
 * Every request that exposes vault content passes through an Authorizer. The
 * default is deny-all: with nothing configured, the dashboard serves nothing,
 * so it is closed by default rather than open by default. Single sign-on plugs
 * in here as a real Authorizer (see sso.ts); until it is configured, the
 * boundary stays shut.
 *
 * This boundary belongs to the control plane only. The open-core vault, server,
 * and CLI never call it and never depend on it, so a vault keeps working with no
 * control plane and no identity provider at all.
 */

export interface Principal {
  subject: string;
}

export interface AuthResult {
  allowed: boolean;
  reason: string;
  principal?: Principal;
}

export type Authorizer = (headers: Record<string, string | undefined>) => AuthResult;

/** The default boundary: deny everything. Fail closed when no identity provider is configured. */
export const denyAll: Authorizer = () => ({ allowed: false, reason: "no identity provider configured (fail closed)" });
