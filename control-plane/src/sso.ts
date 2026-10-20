import { createHmac, timingSafeEqual } from "node:crypto";

import { type Authorizer } from "./auth.js";

/**
 * Single sign-on for the control plane.
 *
 * The control plane does not run its own identity store. It sits behind the
 * team's SSO or OIDC front, which authenticates the person and mints a short
 * session that it hands to the control plane. This module verifies that session
 * and nothing more: it checks the signature against a shared signing secret
 * provided out of band (never in the repository), checks the session has not
 * expired, and checks the subject is on the allowlist when one is set.
 *
 * It fails closed. A missing, malformed, unsigned, expired, or disallowed
 * session is denied, and any error while verifying is a denial. This boundary
 * belongs to the control plane alone; the open-core vault, server, and CLI
 * never call it and never depend on it.
 *
 * The session is `<base64url(payload)>.<base64url(hmacSHA256(payload))>`, where
 * payload is JSON `{ sub: string, exp: number }` with exp in epoch seconds.
 */

export interface SsoConfig {
  /** The HMAC secret shared with the SSO front. Supplied from the environment, never committed. */
  signingMaterial: string;
  /** When non-empty, only these subjects are allowed in. Empty means any validly signed, unexpired subject. */
  allowedSubjects?: string[];
  /** The header carrying the session. Defaults to "authorization" with a "Bearer " prefix. */
  header?: string;
  /** Clock override for tests, in epoch seconds. */
  now?: () => number;
}

function sign(payloadPart: string, material: string): string {
  return createHmac("sha256", material).update(payloadPart).digest("base64url");
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Build an Authorizer that verifies an SSO session. Fails closed on every error path. */
export function makeSsoAuthorizer(config: SsoConfig): Authorizer {
  const headerName = (config.header ?? "authorization").toLowerCase();
  const allow = config.allowedSubjects ?? [];
  const clock = config.now ?? (() => Math.floor(Date.now() / 1000));

  return (headers) => {
    if (!config.signingMaterial) return { allowed: false, reason: "sso not configured (fail closed)" };
    const raw = headers[headerName];
    if (!raw) return { allowed: false, reason: "no session presented" };
    const presented = raw.startsWith("Bearer ") ? raw.slice(7) : raw;

    const dot = presented.indexOf(".");
    if (dot <= 0 || dot === presented.length - 1) return { allowed: false, reason: "malformed session" };
    const payloadPart = presented.slice(0, dot);
    const sigPart = presented.slice(dot + 1);

    if (!constantTimeEqual(sigPart, sign(payloadPart, config.signingMaterial))) {
      return { allowed: false, reason: "bad session signature" };
    }

    let claims: { sub?: unknown; exp?: unknown };
    try {
      claims = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as typeof claims;
    } catch {
      return { allowed: false, reason: "unreadable session payload" };
    }
    const subject = typeof claims.sub === "string" ? claims.sub : "";
    const exp = typeof claims.exp === "number" ? claims.exp : 0;
    if (!subject) return { allowed: false, reason: "session has no subject" };
    if (exp <= clock()) return { allowed: false, reason: "session expired" };
    if (allow.length > 0 && !allow.includes(subject)) return { allowed: false, reason: "subject not allowed" };

    return { allowed: true, reason: "sso session verified", principal: { subject } };
  };
}
