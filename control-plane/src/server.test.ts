import assert from "node:assert/strict";
import { test } from "node:test";

import { type AuditModel } from "./audit.js";
import { type Authorizer, denyAll } from "./auth.js";
import { type ServerDeps, handleRequest } from "./server.js";

const MODEL: AuditModel = {
  generatedAt: "2026-10-20T00:00:00.000Z",
  source: "git",
  counts: { byKind: { fact: 1, decision: 0, thread: 0 }, byStatus: { proposed: 0, quarantined: 0, verified: 1, superseded: 0 }, unreadable: 0 },
  records: [{ id: "f-aaaaaaaaaaaa", kind: "fact", status: "verified", added: "2026-01-01", verified_by: "alice", path: "facts/f-aaaaaaaaaaaa.md" }],
  writebacks: { commits: 1, contributors: 1, recent: [{ commit: "abc", author: "Alice", date: "2026-01-01T00:00:00Z", subject: "memory: seed" }] },
  note: "read-only view; the vault in git remains the source of truth and this dashboard never holds the only copy",
};

const allow: Authorizer = () => ({ allowed: true, reason: "ok", principal: { subject: "alice@example.com" } });
const deps = (authorize: Authorizer): ServerDeps => ({ authorize, audit: async () => MODEL });

test("healthz is open and reveals no vault content", async () => {
  const r = await handleRequest("GET", "/healthz", {}, deps(denyAll));
  assert.equal(r.status, 200);
  assert.equal(r.body.trim(), "ok");
});

test("non-GET methods are rejected (read-only dashboard)", async () => {
  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
    const r = await handleRequest(method, "/audit", {}, deps(allow));
    assert.equal(r.status, 405);
  }
});

test("the audit and dashboard routes fail closed without authorization", async () => {
  const audit = await handleRequest("GET", "/audit", {}, deps(denyAll));
  assert.equal(audit.status, 401);
  assert.match(audit.body, /fail closed/);
  const dash = await handleRequest("GET", "/", {}, deps(denyAll));
  assert.equal(dash.status, 401);
  assert.equal(dash.contentType, "text/html");
});

test("an authorized request gets the audit JSON and the dashboard HTML", async () => {
  const audit = await handleRequest("GET", "/audit", {}, deps(allow));
  assert.equal(audit.status, 200);
  assert.deepEqual(JSON.parse(audit.body), MODEL);
  const dash = await handleRequest("GET", "/", {}, deps(allow));
  assert.equal(dash.status, 200);
  assert.match(dash.body, /Cohort review and audit/);
  assert.match(dash.body, /verified/);
});

test("an unknown path is a 404", async () => {
  const r = await handleRequest("GET", "/secrets", {}, deps(allow));
  assert.equal(r.status, 404);
});
