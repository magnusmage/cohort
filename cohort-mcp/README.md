# cohort-mcp

The Cohort MCP server: the client-neutral engine behind the Cohort shared-memory
vault. It speaks the Model Context Protocol over stdio, so any MCP client can load
team context and propose human-approved writebacks through one server.

Phases 1 through 5 are implemented: the policy engine, record schema, git
transport, and write gate (Phase 1); trust tiers with human-only verification
(Phase 2); session capture and search (Phase 3); the adoption bridge and
portable export and import (Phase 4); and the retrieval and review intelligence
that makes up the moat (Phase 5), described below. The build plan and tickets
are in `docs/planning/` in the repository root.

## Retrieval and review intelligence

The moat is how Cohort stays trustworthy over a large, multi-writer vault:

- **Git-native index.** A committed, diffable index under `.cohort/index/` is
  built from the vault's records and rebuilds byte-identically, so retrieval
  state is reviewable in a pull request and checkable in CI.
- **Token-budgeted, verified-first retrieval.** `cohort_load` fills a hard token
  budget in rank order and stops, so a load stays bounded as the vault grows.
  The cut is verified-first: the budget is never spent on a lower-ranked record
  ahead of a higher one.
- **Contradiction detection.** A proposed fact that negates a verified fact on
  the same topic is held for a human rather than auto-landed.
- **Staleness, supersession, and decay.** A record past its `review_by` horizon
  is surfaced and ranked below fresh records, never dropped automatically. A
  verified record can supersede an older one, which leaves load but stays in git
  history; only a verified supersedes claim is honored.
- **Deterministic merge.** Content-addressed records dedup to one path and never
  collide; an occupied path is never overwritten, so a re-proposal cannot clobber
  a verified record, and a real collision is surfaced for a human.
- **Provenance forensics.** `cohort_why` returns who, which model, when, and why
  a record exists, read from git history, with the writer's self-asserted claim
  shown separately from the authoritative git record.

## Requirements

- Node.js 18 or newer.

## Run it

The server is launched by the client, not installed first:

```sh
npx -y cohort-mcp
```

It starts a stdio server and waits for a client. Register it with Claude Code:

```sh
claude mcp add cohort -- npx -y cohort-mcp
```

After that, the client lists these tools:

| Tool | Purpose |
|---|---|
| `cohort_load` | Return bounded team context from the vault, fenced as data not instructions, verified-first. |
| `cohort_propose` | Run proposed records through the server-enforced write gate. |
| `cohort_status` | Report the effective policy, record counts, and the quarantine queue. |
| `cohort_policy_get` | Return the caller's effective, read-only policy limits. |
| `cohort_search` | Search the vault, honoring readable scope; verified-only by default, with an include_quarantined opt-in. |
| `cohort_why` | Return a record's provenance (who, which model, when, why) read from git history. Read-only. |

## CLI

Some actions are human-run on the terminal, by design, not callable by the model:

```sh
cohort init --vault <dir> --agent <id>            # seed policy, wire Claude, print next steps
cohort verify --vault <dir> --by <handle> <id>    # promote a record from quarantined to verified
cohort supersede --vault <dir> --old <id> --new <id>  # mark a record replaced; it leaves load, stays in history
cohort stats --vault <dir>                        # record counts, writebacks, current load size
cohort index --vault <dir>                        # build the committed, diffable retrieval index (--check to verify)
cohort bridge --vault <dir>                       # generate AGENTS.md, CLAUDE.md, Cursor rules from the vault
cohort reabsorb --vault <dir> --file <name>       # reabsorb hand-edits to a generated file as gated proposals
cohort export --vault <dir> --out <file>          # export the whole vault to a portable JSON document
cohort import --vault <dir> --in <file>           # import records from a portable document (writes, you commit)
```

`verify` and `supersede` are CLI commands rather than tools so the model can
propose and read but never promote or retire a record. Session capture (turning
session notes into classified draft records) feeds the propose flow; the drafts
still pass the gate.

A superseded record keeps its file and stays in git history, but drops out of
load, so retired memory is retrievable but not served. Only a verified record's
supersedes claim is honored, so a low-trust record cannot hide a verified one. A
record past its `review_by` horizon is stale: it is surfaced in `cohort_status`
and labeled in loaded context, and it ranks below fresh records within its trust
tier, but it is never removed or trusted less automatically.

The adoption bridge keeps the files teams already use. `bridge` generates
AGENTS.md, CLAUDE.md, and Cursor rules from the vault's verified records;
`reabsorb` turns hand-edits to those files back into gated proposals, so the
vault stays the source of truth and nothing is written back silently; `export`
and `import` move a whole vault losslessly on a portable schema.

The retrieval index is a committed, diffable JSON document under
`.cohort/index/`, built from the vault's records. `index` rebuilds it and
`index --check` reports any drift from the vault, so a reviewer sees exactly
what retrieval will see. A rebuild on the same committed vault is byte-identical,
and the index holds record metadata and size estimates only, never record
bodies, so committing it never widens what a reader can see.

## Develop

```sh
npm install        # install pinned dependencies
npm run build      # compile src to dist
npm run typecheck  # type-check without emitting
npm run lint       # eslint over src
npm test           # build the test target and run the suite
npm run audit      # fail on a high or critical advisory
```

Tests use Node's built-in test runner, so there is no extra test-framework
dependency. The suite connects an in-memory client to the server and covers the
policy engine, the record schema, the git transport, the write gate, and each
tool, alongside end-to-end and adversarial suites.

## Security

The server is the only trusted component in Cohort. It enforces consent against
the vault's `policy.yml`, scans every write for secrets and PII, fences loaded
memory as data not instructions, and only ever commits through the write gate;
promotion to verified is a human-only CLI action. A proposed fact that negates a
verified fact on the same topic is held for a human rather than auto-landed, so
a poisoned fact cannot quietly override verified memory. Records are
content-addressed, so concurrent writebacks of the same fact dedup to one path
and distinct facts never collide; a path that is already occupied is never
overwritten, so a re-proposal cannot clobber a verified record, and a real
collision is surfaced for a human. It makes no network calls
beyond the user's own git remote and no telemetry. The runtime dependency
surface is deliberately small: the MCP SDK, zod, yaml, and picomatch, all
pinned, with a committed lockfile and an audit step.

## License

Apache-2.0. Part of [magnusmage/cohort](https://github.com/magnusmage/cohort).
