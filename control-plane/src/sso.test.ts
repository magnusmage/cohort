import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

import { makeSsoAuthorizer } from "./sso.js";

const MATERIAL = "shared-with-the-sso-front";

/** Mint a session the way the SSO front would. */
function session(payload: object, material = MATERIAL): string {
  const part = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", material).update(part).digest("base64url");
  return `${part}.${sig}`;
}

const fixedClock = (): number => 1_000_000;
const authz = makeSsoAuthorizer({ signingMaterial: MATERIAL, now: fixedClock });

test("a valid, unexpired session is allowed and carries the subject", () => {
  const r = authz({ authorization: `Bearer ${session({ sub: "alice@example.com", exp: 1_000_100 })}` });
  assert.equal(r.allowed, true);
  assert.equal(r.principal?.subject, "alice@example.com");
});

test("a session with a bad signature is denied", () => {
  const forged = session({ sub: "alice@example.com", exp: 1_000_100 }, "wrong-material");
  const r = authz({ authorization: `Bearer ${forged}` });
  assert.equal(r.allowed, false);
  assert.match(r.reason, /signature/);
});

test("an expired session is denied", () => {
  const r = authz({ authorization: `Bearer ${session({ sub: "alice@example.com", exp: 999_999 })}` });
  assert.equal(r.allowed, false);
  assert.match(r.reason, /expired/);
});

test("a missing or malformed session is denied", () => {
  assert.equal(authz({}).allowed, false);
  assert.equal(authz({ authorization: "Bearer not-a-session" }).allowed, false);
  assert.equal(authz({ authorization: "Bearer .onlysig" }).allowed, false);
});

test("the subject allowlist is enforced", () => {
  const gated = makeSsoAuthorizer({ signingMaterial: MATERIAL, allowedSubjects: ["alice@example.com"], now: fixedClock });
  assert.equal(gated({ authorization: `Bearer ${session({ sub: "alice@example.com", exp: 1_000_100 })}` }).allowed, true);
  const denied = gated({ authorization: `Bearer ${session({ sub: "mallory@evil.test", exp: 1_000_100 })}` });
  assert.equal(denied.allowed, false);
  assert.match(denied.reason, /not allowed/);
});

test("an unconfigured signing material fails closed", () => {
  const unconfigured = makeSsoAuthorizer({ signingMaterial: "", now: fixedClock });
  assert.equal(unconfigured({ authorization: `Bearer ${session({ sub: "alice@example.com", exp: 1_000_100 })}` }).allowed, false);
});

test("a payload without a subject is denied", () => {
  const r = authz({ authorization: `Bearer ${session({ exp: 1_000_100 })}` });
  assert.equal(r.allowed, false);
  assert.match(r.reason, /subject/);
});
