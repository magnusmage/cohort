# Cohort build plan

Phased, prioritized implementation plan for the Claude connector and the shared
`cohort-mcp` server. Everything here is approved scope. Build top down: each phase
is shippable and dogfoodable on its own, and each depends only on the ones above it.

> Scope. "Claude side" means the client-neutral `cohort-mcp` server (the engine)
> plus Claude wiring (Claude Code via `claude mcp add`, Claude Desktop config, and
> the existing `SKILL.md` as a no-MCP fallback). The server is reusable for Cursor,
> Codex, and Gemini CLI later, but we build and verify it on Claude first.

## Stack assumption

- `cohort-mcp` server: Node and TypeScript, distributed via `npx -y cohort-mcp`
  (no pre-install; the client launches it). Matches the existing Node toolchain
  and the MCP TypeScript SDK. If code-side prefers Python and `uvx`, swap freely.
  Nothing below depends on the language.
- Vault operations (init, validate, redaction hook): keep the existing shell
  scripts; the server shells out to git.
- The server is a local stdio process. The "no servers" claim becomes "no hosted
  server, no account with us". Update the docs to say exactly that.

## Conventions

- Conventional Commits with DCO sign-off (`git commit -s`), as the repo already uses.
- Author commits as the maintainer only. No AI or assistant attribution in commits,
  pull requests, issues, or code.
- Every phase ships with tests and updates `docs/` in the same pull request.
- Plain, human writing in all output. No em dashes.

## Security first, on every ticket in every phase

Cohort is shared memory that multiple agents read and write. That makes the memory
itself an attack surface: a poisoned record becomes an instruction to every other
teammate's agent. Security is a property of every ticket, not a later phase.

Trust model, assumed everywhere:

- The server is the only trusted component and the only thing that commits. The
  model is untrusted. Stored memory is untrusted data. A teammate's writeback is
  untrusted. A connected client is untrusted.
- Approval is enforced by the server against `policy.yml`, never requested of the
  model. Fail closed on any ambiguity.

Threats every ticket defends against: prompt injection through stored memory,
memory poisoning, secret or PII leakage, path traversal and scope escape, approval
bypass and privilege escalation, command and argument injection when shelling out
to git or gh, and supply-chain risk in the npx-distributed server and its
dependencies.

Secure-by-design rules applied to every change:

- Read-time data-fencing ships in Phase 1, in the first version of `cohort_load`,
  so there is never a released state where loaded memory is unfenced. Phase 2
  hardens it; it does not introduce it.
- Secret and PII scanning runs on every write, reusing the existing gitleaks
  rules. If the scanner is missing, fail closed.
- No shell string interpolation. Call git and gh with argument arrays. Never build
  a shell command from record fields, topics, or any model or teammate value.
- Validate every input. Schema-validate tool parameters and every record field,
  enforce length limits, reject control characters and embedded frontmatter or
  markers that could break the data-fence.
- Canonicalize and bound every path against the allow-list. Reject anything
  resolving outside the vault or matching `paths.deny`. `deny` and the never
  classes are hard; no `auto` rule or approval overrides them.
- Least privilege and no secret logging. Minimal token scopes. Never print tokens,
  keys, or raw secret matches.
- Dependency hygiene: lockfile, pinned versions, `npm audit` in CI, and a pinned,
  version-tagged server in the install command.

## Invariants, true in every phase, never violated

1. The model can only propose. The server commits. Approval is enforced by the
   server against `policy.yml`, never requested of the model.
2. Fail closed. Unknown class, unreadable policy, missing gate check, or ambiguous
   classification means deny and ask.
3. The vault is the source of truth and the user owns it. All config (`policy.yml`)
   and all memory are human-readable files, diffable, revertible, and revocable by
   editing a file.
4. Read-consent and write-consent are separate settings.
5. Secret, credential, and PII classes are hard denied and cannot be overridden by
   the model or by an `auto` rule.

## Shared contracts, used from Phase 1 on

### Vault layout, added on top of today's `vault-template/`

```
.cohort/
  policy.yml          # the consent and autonomy control surface (versioned)
  index/              # Phase 5: committed, diffable retrieval index
facts/                # atomic, id-addressed knowledge records
decisions/            # architecture and convention decisions
threads/              # open work, handoffs, blocked-on state
VAULT.md              # entry manifest (already exists)
```

`.cohort/` is never writable by the model. The server writes `policy.yml`, and only
on an explicit human action (for example a "don't ask again" choice).

### `policy.yml`, the consent model

```yaml
defaults:
  load:     ask          # ask | auto | manual   (reading context at session start)
  propose:  ask          # ask | auto | never    (writing back)
  on_write: pull_request # pull_request | direct_commit

classes:                 # autonomy per kind of memory
  coding-convention:     { propose: auto }
  architecture-decision: { propose: ask }
  secret-or-credential:  { propose: never }   # hard deny
  customer-pii:          { propose: never }   # hard deny

paths:                   # scoping by glob
  readable: ["facts/**", "decisions/**", "threads/**"]
  writable: ["facts/**", "decisions/**", "threads/**"]
  deny:     ["**/.env", "**/*secret*", "private/**"]

agents:                  # per-identity autonomy (the multi-agent dial)
  "ci-bot":            { load: auto, propose: never }
  "claude-code@alice": { load: auto, propose: ask }
```

- `load: manual` means never auto-load; return context only when the user invokes
  `cohort_load`.
- Agent identity is established by the server at `cohort init` time (written into
  the client's MCP config) or from the git or OS identity. It is never taken from a
  model-supplied tool argument, or the per-agent dial would be forgeable.
- "Don't ask again" writes an `auto` line, as a visible, revocable commit made by
  the server on an explicit human action.

### Record envelope, shared by facts, decisions, and threads

```yaml
id: f-2026-0417            # content-addressed: short hash of normalized text + kind
kind: fact                 # fact | decision | thread
text: "API gateway rate-limits at 100 req/s per key"
status: quarantined        # proposed | quarantined | verified | superseded
confidence: medium
source:
  agent: "claude-code@alice"
  model: "claude-..."
  commit: a1b2c3
added: 2026-10-19
review-by: 2027-01-19       # decay horizon (Phase 5)
supersedes: null
verified-by: null           # set by a human on promotion
# thread-only: owner, state (open | blocked | done), blocked-on
```

Provenance is authoritative from git history, not from the self-declared `source`
field. Machine-written records land `quarantined` from Phase 1, so no migration is
needed when promotion via `cohort_verify` arrives in Phase 2.

### MCP tools, built up across phases

| Tool | Phase | Purpose |
|---|---|---|
| `cohort_load(topics?, scope?)` | 1 | Return bounded context, fenced as data not instructions, respecting `paths.readable` and policy; reports what was withheld. |
| `cohort_propose(items[])` | 1 | Run the gate. Lands as quarantine, PR, or commit per policy. Never commits silently. |
| `cohort_status()` | 1 to 3 | Policy summary, pending reviews, quarantined count, stale and expiring facts. |
| `cohort_policy_get()` | 1 | The model may read its limits; only a human edits `policy.yml`. |
| `cohort_verify(ids[])` | 2 | Human-only: promote `quarantined` to `verified`. |
| `cohort_search(query, include_quarantined?)` | 3 | Lookup across the vault. |
| `cohort_why(id)` | 5 | git blame as memory forensics: who, which model, when, and why a record exists. |

### The write gate, enforced inside `cohort_propose`

```
1. deny-check        paths.deny + never-classes + any .cohort/ target  -> hard reject   (P1)
2. secret-scan       gitleaks on content; missing scanner -> reject     -> hard reject   (P1)
3. instruction-lint  imperative / "ignore previous" / tool-shaped text  -> quarantine    (P1 minimal, P2 full)
4. dedup             near-duplicate of an existing record               -> merge or skip (P3 to P5)
5. contradiction     conflicts a verified record on the same topic      -> flag to human (P5)
6. classify          assign class and confidence; safest on ambiguity   (P1 basic, P5 smart)
7. decide            policy(class, agent) -> auto | ask | never, using the server-established identity
8. land              direct_commit | pull_request | quarantine
```

Phase 1 ships steps 1, 2, a minimal 3, 6-basic, 7, and 8. `auto` only lands after
the secret-scan and the minimal instruction-lint pass, so a declared class cannot
self-authorize a write. The full linter and quarantine tiers arrive in Phase 2;
dedup and contradiction arrive in Phase 3 to 5.

## Phase 1, walking skeleton (safe, end to end, on Claude)

Goal: a Claude user installs in one step and runs a full load, propose,
human-approve, commit loop, with the policy gate already enforcing. This is the MVP
vertical slice; everything after is depth.

Features: `cohort-mcp` server skeleton (stdio) with `cohort_load`, `cohort_propose`,
`cohort_status`, `cohort_policy_get`; `policy.yml` read and enforce; record schema
and provenance on every proposal; git transport (`load` is pull and read, `propose`
is write and PR, or direct commit per policy); read-time data-fencing in
`cohort_load`; secret and PII scan in the gate; one-step `cohort init` wiring Claude
Code and Claude Desktop, reusing `setup.sh`, with a `SKILL.md` fallback for no-MCP
clients.

Acceptance: fresh machine, one command, a working vault and Claude Code sees the
tools; a `propose: ask` item blocks until a human approves, then lands a PR or
commit with provenance; a `secret-or-credential` item, or a secret planted in a
benign-class record, is hard rejected; the server reads `policy.yml` and the model
cannot write it; loaded memory is fenced from the first version.

Depends on: nothing. Tickets P1-0 through P1-11 are in `COHORT-PHASE1-TICKETS.md`.

## Phase 2, trust and safety spine

Goal: make the security positioning literally true and solve the defining
multi-agent failure, poisoned or unverified memory propagating between agents.

Features: trust tiers (machine-written lands `quarantined`, readable but flagged;
`cohort_verify`, human-only, promotes to `verified`; `cohort_load` returns
verified-first and marks quarantined items); the full instruction linter on write
(versioned like the gitleaks rules); hardened read-time data-fencing; a quarantine
queue in `cohort_status`.

Acceptance: an agent-asserted fact never reaches `verified` without a human; a
planted "ignore previous instructions" writeback is quarantined, not committed;
loaded context is unambiguously fenced as data.

Depends on: Phase 1.

## Phase 3, usability (remove the manual-curation tax)

Goal: the human approves instead of curates.

Features: auto session-capture (a structured extractor that turns a session into
fact, decision, and thread records in schema, with provenance, ready for the gate;
the human edits and approves the draft); `cohort_search` across the vault (plain
text and tags for now; semantic in Phase 5); `cohort stats` (context loaded,
writebacks approved or rejected, re-explanations avoided, tokens per load).

Acceptance: end of session produces a clean, classified, provenance-stamped draft
set; stats reports reuse and time saved; search returns relevant records.

Depends on: Phases 1 and 2.

## Phase 4, adoption bridge (zero-cost onboarding)

Goal: teams keep the files they already have; Cohort becomes the reviewed source of
truth behind them.

Features: two-way `AGENTS.md`, `CLAUDE.md`, and Cursor-rules sync (generate them
from the vault; reabsorb hand-edits as proposals through the gate); export and
import (portable vault to and from these formats; a common schema other tools can
read).

Acceptance: editing `CLAUDE.md` by hand produces a gated proposal; regenerating
from the vault is idempotent; round-trip export and import is lossless.

Depends on: Phases 1 to 3.

## Phase 5, moat: retrieval and review intelligence

Goal: the depth that makes Cohort one of a kind over a large, multi-writer vault.

Features: git-native retrieval (a committed, diffable index under `.cohort/index/`;
`cohort_load` returns ranked, token-budgeted, verified-first results within a hard
cap, a serverless RAG you can review in a PR); contradiction detection (gate step 5);
staleness, supersession, and decay (`review-by` horizons; `supersedes` drops old
facts from load but keeps them in git history); deterministic merge and conflict
surfacing for concurrent writebacks; `cohort_why(id)` git-blame forensics.

Acceptance: retrieval stays under the token cap as the vault grows; a contradicting
fact is caught, not silently landed; superseded facts leave `load` but stay in
history; two agents proposing at once do not clobber.

Depends on: Phases 1 to 4.

## Phase 6, enterprise (optional, hold)

Fine-grained multi-vault access, at-rest encryption (age or git-crypt), retention
and recovery, a hosted review and audit dashboard, SSO. Open core: the vault, CLI,
and server stay Apache-2.0; charge for the control plane, never the memory. Build
only if teams pull, and only on explicit go-ahead.

## Priority summary

| Priority | Phase | Why now |
|---|---|---|
| P0 | 1, walking skeleton | Safe, runnable, on Claude. Nothing exists without it. |
| P0 | 2, trust and safety | Makes the consent and anti-poisoning promise true. The differentiator, and cheap. |
| P1 | 3, usability | Removes the manual-curation tax; produces the "it saves time" evidence. |
| P1 | 4, adoption bridge | Drops onboarding cost to zero; the "become the standard" lever. |
| P2 | 5, moat | Real one-of-a-kind depth; pays off on a used, multi-writer vault. |
| P3 | 6, enterprise | Revenue layer; build only on demonstrated pull. |

Ship P0 and P1 to get and keep users. Build P2 once the wedge holds. Touch P3 only
if teams pay to pull it.
