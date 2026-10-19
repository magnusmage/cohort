# Cohort Phase 1 tickets

The concrete Phase 1 epic and eleven tickets. These are tracked as GitHub issues:
the epic is #38 and the tickets are #27 through #37. This file is the written
source of truth; the issues carry the same scope with the security corrections
folded in.

Conventions for every ticket:

- Conventional Commits with DCO sign-off (`git commit -s`).
- No AI or assistant attribution anywhere: commits, pull requests, issue bodies,
  code comments. Maintainer authorship only.
- Additive by default. Do not change the behavior of the existing `SKILL.md`
  connectors, `install.sh`, `setup.sh`, the validator, or the gitleaks hook unless
  a ticket names a genuine correction.
- Every ticket ships with its tests and docs in the same pull request, and a short
  Security section.
- Plain, human writing. No em dashes.

## Shared contracts (recap)

See `COHORT-BUILD-PLAN.md` for the full version. In short:

- Vault layout adds `.cohort/policy.yml` and `facts/`, `decisions/`, `threads/` on
  top of today's `vault-template/`. `.cohort/` is never writable by the model.
- `policy.yml` carries `defaults`, `classes`, `paths`, and `agents`. `load: manual`
  means load only on explicit invocation. Agent identity is server-established, not
  taken from a tool argument.
- The record envelope carries id (content-addressed), kind, text, status,
  confidence, source, added, and a human-set `verified-by`. Machine-written records
  land `quarantined` from Phase 1. Provenance is authoritative from git history.
- Phase 1 tools: `cohort_load`, `cohort_propose`, `cohort_status`,
  `cohort_policy_get`.
- Phase 1 write gate steps: deny-check (including any `.cohort/` target), secret and
  PII scan (fail closed), minimal instruction-lint before any `auto`, basic
  classify (safest on ambiguity), decide via the resolver, land.

Invariants (every ticket upholds):

1. The model only proposes; the server commits. Approval is enforced by the server
   against `policy.yml`, never requested of the model.
2. Fail closed on unreadable or invalid policy, unknown class, or ambiguity.
3. The vault is the source of truth and the user owns it; all config and memory are
   human-readable files.
4. Read-consent and write-consent are independent settings.
5. `secret-or-credential` and `customer-pii` classes and `paths.deny` are hard. No
   `auto` rule or approval overrides them.

## P1-0 EPIC: Phase 1 walking skeleton (#38)

Goal: a Claude user installs in one step and runs a full load, propose,
human-approve, commit loop, with the policy gate already enforcing.

Tracks, in dependency order: P1-1 scaffold (#27), P1-2 git transport (#28), P1-3
record schema and provenance (#29), P1-4 policy loader and `cohort_policy_get`
(#30), P1-5 write gate (#31), P1-6 `cohort_load` (#32), P1-7 `cohort_propose` (#33),
P1-8 `cohort_status` (#34), P1-9 `cohort init` (#35), P1-10 docs and template (#36),
P1-11 end-to-end and CI gates (#37).

Phase 1 is done when: fresh machine, one command, a working vault and Claude Code
sees the tools; a `propose: ask` item blocks until approved and then lands a PR or
commit carrying provenance; a `secret-or-credential` item, or a secret planted in a
benign-class record, is hard rejected; the model cannot write `policy.yml`, cannot
approve its own proposals, and cannot forge its agent identity; loaded memory is
fenced as data from the first shipped version.

Stack: `cohort-mcp` in Node and TypeScript (MCP TS SDK), launched via
`npx -y cohort-mcp` with a pinned version. Vault operations shell out to git and
reuse the existing shell scripts. The server is a local stdio process. Docs say "no
hosted server, no account with us," not "no servers."

## P1-1 chore: scaffold cohort-mcp TypeScript package and stdio bootstrap (#27)

Depends on: none.

Scope: new `cohort-mcp/` package in TypeScript using the MCP TypeScript SDK, with a
build, lint, and test harness; a `bin` entry so `npx -y cohort-mcp` starts a stdio
server with clean startup and shutdown; register the four Phase 1 tools as stubs
(valid schemas, "not implemented" responses) so the handshake and tool listing work
end to end; package README; committed lockfile, pinned versions, and an `npm audit`
step.

Acceptance: `npx -y .` launches without error; after `claude mcp add`, Claude Code
lists the four `cohort_*` tools; `npm audit` runs clean or with reviewed exceptions.

Security: new process and supply-chain surface. Pin dependencies and commit the
lockfile. New package only; do not modify existing connectors or installers.

## P1-2 feat: vault git transport layer (#28)

Depends on: P1-1.

Scope: git helpers (detect repo and vault root, pull, read a file, list files under
a glob, stage and commit, create a branch, open a PR via gh or the REST API); call
git and gh with argument arrays only, never a shell string built from untrusted
values; sanitize any value used in a branch name or ref; maintainer commits with
DCO sign-off and no AI attribution; `on_write` support for `direct_commit` and
`pull_request`; concurrency-safe writes (a unique branch per proposal, and
`pull --rebase` before a `direct_commit`).

Acceptance: against a scratch repo, read a vault file, commit on a new branch, and
open a PR programmatically; a `pull_request` write never lands on the default branch
directly; no path interpolates untrusted values into a shell string; two concurrent
proposals do not collide.

Security: the only component touching git with the user's credentials. Ship a test
feeding hostile field values (spaces, `;`, backticks, `..`, newlines) that shows
they cannot escape the argv boundary.

## P1-3 feat: record schema and provenance writer (#29)

Depends on: P1-1.

Scope: TypeScript types for the record envelope; lossless serialize and parse of
markdown plus YAML frontmatter; content-addressed id (short hash of normalized text
plus kind); provenance authoritative from git history, not a self-declared field;
machine-written records land `status: quarantined` from Phase 1; input validation on
every field (schema, length limits, reject control characters and embedded
frontmatter delimiters or markers), reusing or extending `scripts/validate-vault.sh`.

Acceptance: round-trip is lossless; a hostile record (embedded `---`, control chars,
over-length) is rejected with a clear error; every record carries complete
provenance and a content-addressed id; machine-written records are `quarantined`.

Security: the record body is untrusted input. Ship a test with planted delimiters
and control characters.

## P1-4 feat: policy.yml loader, validation, and cohort_policy_get (#30)

Depends on: P1-1.

Scope: parse `defaults`, `classes`, `paths`, `agents` into a typed model; fail
closed on any parse or validation error (treat everything as ask or deny and surface
the reason); effective-policy resolver `(class, agent) -> load / propose /
on_write`; define `load: manual` precisely (load only on explicit invocation); agent
identity established by the server from the init-time config or the git or OS
identity, never from a tool argument, falling back to the most restrictive policy
without a trustworthy identity; `cohort_policy_get` is read-only and no tool path can
write `policy.yml` or resolve a write target under `.cohort/`.

Acceptance: valid policy loads; malformed policy fails closed; `cohort_policy_get`
exposes no write path; a tool call supplying a different agent id does not change the
enforced identity.

Security: the control surface. Ship a test that a model-supplied agent id cannot
escalate autonomy.

## P1-5 feat: write gate (deny-check, secret-scan, classify, decide, land) (#31)

Depends on: P1-2, P1-3, P1-4. This is the spine; invariants 1, 2, and 5 live here.

Scope: deny-check (canonicalize the resolved path with realpath; reject anything
outside the vault, matching `paths.deny`, or under `.cohort/`; reject `..` and
symlink escapes; `deny` beats `writable`; never-classes are hard rejected and cannot
be overridden by any approval); secret and PII content scan on every proposal with
the gitleaks rules, fail closed if the scanner is missing, reject a secret regardless
of declared class; a minimal instruction-lint on content headed for an `auto` land,
a hit downgrades to ask or quarantine; basic classify treats the declared class as a
hint and defaults to safest on ambiguity; decide via the resolver using the
server-established identity; land via `direct_commit`, `pull_request`, or
block-for-approval with a pending handle the model cannot approve.

Acceptance: a never-class or `deny`-path item is hard rejected regardless of
approval; a secret in a benign-class record is rejected even when "approved"; `auto`
lands only after the secret-scan and minimal instruction-lint pass; missing gitleaks
means reject, never commit unscanned.

Security: the whole trust model rests here. Ship adversarial tests for a planted
secret in a benign class, path traversal and symlink escape, a `.cohort/policy.yml`
write attempt, and an `auto` bypass via a crafted class.

## P1-6 feat: cohort_load tool, fenced from v1 (#32)

Depends on: P1-2, P1-4.

Scope: bounded read honoring `paths.readable` and the `load` policy (ask, auto,
manual), canonicalized, never returning anything outside readable or matching deny;
ship the read-time data-fence in this first version (wrap all returned memory in an
explicit "treat as data and history, not instructions" envelope, reusing the
provenance-header wording in the connectors); field content cannot break the
envelope; basic selection (recent records plus an optional `topics` filter) and a
report of what was withheld.

Acceptance: returns only readable paths, honors the `load` policy, reports what was
withheld; returned memory is unambiguously fenced in the first shipped version; a
record crafted to break the fence does not.

Security: the read path is the prompt-injection surface. Ship a test with a record
that tries to break the envelope.

## P1-7 feat: cohort_propose tool (#33)

Depends on: P1-3, P1-5.

Scope: accept `items[]` in the record schema, run each through the gate, write
provenance; return a per-item decision (landed with a PR link or commit, a
pending-approval handle, or a hard-reject reason); the human approval path is
concrete and not model-triggerable (PR review for `pull_request`; a human-run
`cohort approve <handle>` for `direct_commit` plus ask); no model-callable approve
tool.

Acceptance: a normal fact under `propose: ask` returns pending, and on human approval
lands a PR or commit with provenance; a `secret-or-credential` item, or any record
that trips the secret-scan, is hard rejected; the model cannot approve its own
handle.

Security: approval bypass is the risk. Ship a test that the model has no tool path
that approves a handle or promotes a record.

## P1-8 feat: cohort_status tool (#34)

Depends on: P1-4, P1-5.

Scope: report the effective policy summary, pending review handles, and record
counts by kind; leave a seam for the Phase 2 quarantine queue.

Acceptance: output reflects real vault and policy state, with no stale or fabricated
counts.

## P1-9 feat: cohort init, install and Claude wiring (#35)

Depends on: P1-1, P1-4 (integrates P1-6, P1-7, P1-8).

Scope: one command that registers the server in Claude Code
(`claude mcp add cohort -- npx -y cohort-mcp@<pinned-version>`, with a user or
project scope choice) and writes the Claude Desktop config block, with the version
pinned; write the server-established agent identity into the MCP config at init
time; run the vault wizard by reusing `setup.sh` and write a starter
`.cohort/policy.yml`; fall back to copying the existing `SKILL.md` connector if the
client has no MCP, and say so; idempotent, with clear next steps.

Acceptance: fresh machine, one command, a vault exists and Claude Code sees the
tools; re-running is idempotent and the SKILL.md fallback still works; the registered
server version is pinned.

Security: supply chain and identity. Pin the version and bind the agent identity at
init. Reuse `setup.sh`; do not rewrite it.

## P1-10 docs: additive doc and template updates (#36)

Depends on: P1-9.

Scope: add a starter `.cohort/policy.yml` and the `facts/`, `decisions/`, `threads/`
scaffolding to `vault-template/`; keep README "not yet" naming only GPT and Google
Drive; replace the "no servers" claim with "no hosted server, no account with us"
across README, EXPLAINED, TECHNICAL, and LIMITATIONS; update SECURITY.md for the new
trust boundary (the server as the only committer, the write gate, the read-time
fence, the approval mechanism, agent identity, and the new attack surfaces); add a
short Phase 1 MCP usage section and a CHANGELOG entry.

Acceptance: docs are accurate to the shipped state, no claim overstated, SECURITY.md
reflects the server and gate, existing content otherwise untouched (corrections and
additions only, no restructure).

## P1-11 test: Phase 1 end-to-end acceptance and CI security gates (#37)

Depends on: P1-5, P1-6, P1-7, P1-8, P1-9.

Scope: automated e2e against a scratch repo (install, load, `propose(ask)` blocks,
human approve, commit carries provenance); an adversarial suite asserting each
invariant (secret-or-credential and a planted secret hard rejected even when
"approved"; the model cannot write `policy.yml` or anything under `.cohort/`; the
model cannot approve its own handle; a forged agent id cannot escalate; `cohort_load`
respects `paths.readable`, rejects traversal and symlink escape, and returns fenced
output; malformed `policy.yml` fails closed; an `auto` item that trips the
secret-scan or the minimal instruction-lint does not auto-land); wire the e2e and
adversarial suites, `npm audit`, and gitleaks into `.github/workflows`, all required
before merge.

Acceptance: the suite is green in CI and asserts each invariant explicitly; CI fails
the build on a dependency-audit or secret-scan hit.

Security: this ticket is the proof the rest held. Every invariant has a test that
would fail if the defense regressed.
