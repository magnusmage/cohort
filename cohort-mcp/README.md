# cohort-mcp

The Cohort MCP server: the client-neutral engine behind the Cohort shared-memory
vault. It speaks the Model Context Protocol over stdio, so any MCP client can load
team context and propose human-approved writebacks through one server.

Phase 1 (the walking skeleton) and Phase 2 (the trust and safety spine) are
implemented: the policy engine, record schema, git transport, write gate, the
tools below, trust tiers with human-only verification, and the install command.
The build plan and tickets are in `docs/planning/` in the repository root.

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

## CLI

Some actions are human-run on the terminal, by design, not callable by the model:

```sh
cohort init --vault <dir> --agent <id>            # seed policy, wire Claude, print next steps
cohort verify --vault <dir> --by <handle> <id>    # promote a record from quarantined to verified
cohort stats --vault <dir>                        # record counts, writebacks, current load size
cohort index --vault <dir>                        # build the committed, diffable retrieval index (--check to verify)
cohort bridge --vault <dir>                       # generate AGENTS.md, CLAUDE.md, Cursor rules from the vault
cohort reabsorb --vault <dir> --file <name>       # reabsorb hand-edits to a generated file as gated proposals
cohort export --vault <dir> --out <file>          # export the whole vault to a portable JSON document
cohort import --vault <dir> --in <file>           # import records from a portable document (writes, you commit)
```

`verify` is a CLI command rather than a tool so the model can propose and read
but never promote. Session capture (turning session notes into classified draft
records) feeds the propose flow; the drafts still pass the gate.

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
a poisoned fact cannot quietly override verified memory. It makes no network calls
beyond the user's own git remote and no telemetry. The runtime dependency
surface is deliberately small: the MCP SDK, zod, yaml, and picomatch, all
pinned, with a committed lockfile and an audit step.

## License

Apache-2.0. Part of [magnusmage/cohort](https://github.com/magnusmage/cohort).
