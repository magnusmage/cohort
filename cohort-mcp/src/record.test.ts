import assert from "node:assert/strict";
import { test } from "node:test";

import { type VaultRecord, computeId, createRecord, parseRecord, serializeRecord } from "./record.js";

const source = { agent: "claude-code@alice", model: "claude-opus-4-8", commit: "a1b2c3d" };

test("createRecord stamps provenance and lands quarantined", () => {
  const rec = createRecord({ kind: "fact", text: "API gateway rate-limits at 100 req/s per key", source });
  assert.equal(rec.meta.status, "quarantined");
  assert.match(rec.meta.id, /^f-[0-9a-f]{12}$/);
  assert.equal(rec.meta.verified_by, null);
  assert.deepEqual(rec.meta.source, { agent: source.agent, model: source.model, commit: "a1b2c3d" });
  assert.match(rec.meta.added, /^\d{4}-\d{2}-\d{2}$/);
});

test("serialize then parse is lossless", () => {
  const rec = createRecord({ kind: "decision", text: "Use Postgres for the primary store.", source });
  const round: VaultRecord = parseRecord(serializeRecord(rec));
  assert.deepStrictEqual(round, rec);
});

test("a body containing --- lines round-trips", () => {
  const rec = createRecord({
    kind: "fact",
    text: "Before:\n\n---\n\nAfter: a horizontal rule in the body must survive.",
    source,
  });
  const round = parseRecord(serializeRecord(rec));
  assert.equal(round.text, rec.text);
  assert.deepStrictEqual(round.meta, rec.meta);
});

test("ids are content addressed and deterministic", () => {
  const a = computeId("fact", "same text");
  const b = computeId("fact", "same text");
  const c = computeId("fact", "different text");
  assert.equal(a, b);
  assert.notEqual(a, c);
  // Normalization: surrounding whitespace does not change the id.
  assert.equal(computeId("fact", "  trimmed  "), computeId("fact", "trimmed"));
});

test("rejects empty text, control characters, and unsafe scalars", () => {
  assert.throws(() => createRecord({ kind: "fact", text: "", source }), /must not be empty/);
  assert.throws(
    () => createRecord({ kind: "fact", text: "has a null\u0000byte", source }),
    /control characters/,
  );
  assert.throws(
    () => createRecord({ kind: "fact", text: "ok", source: { agent: "bad\nagent", model: "m", commit: null } }),
    /invalid record frontmatter/,
  );
});

test("parseRecord fails closed on malformed input", () => {
  assert.throws(() => parseRecord("no frontmatter here"), /frontmatter opening/);
  assert.throws(() => parseRecord("---\nid: nope\n---\nbody"), /invalid record frontmatter/);
});

test("thread fields are preserved only when present", () => {
  const thread = createRecord({
    kind: "thread",
    text: "Migrate the billing service.",
    source,
    owner: "alice",
    state: "open",
    blockedOn: null,
  });
  assert.equal(thread.meta.state, "open");
  const round = parseRecord(serializeRecord(thread));
  assert.deepStrictEqual(round, thread);

  const fact = createRecord({ kind: "fact", text: "No thread fields here.", source });
  assert.equal("state" in fact.meta, false);
});
