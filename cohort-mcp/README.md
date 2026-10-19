# cohort-mcp

The Cohort MCP server: the client-neutral engine behind the Cohort shared-memory
vault. It speaks the Model Context Protocol over stdio, so any MCP client can load
team context and propose human-approved writebacks through one server.

This package is the Phase 1 scaffold. The four Phase 1 tools are registered and the
handshake works end to end, but each tool is a stub that returns an explicit
"not implemented yet" response. The real behaviour lands in the following Phase 1
tickets (git transport, policy loader, write gate, and the load and propose tools).
See `docs/planning/COHORT-PHASE1-TICKETS.md` in the repository root.

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

After that, the client lists four tools:

| Tool | Purpose |
|---|---|
| `cohort_load` | Return bounded team context from the vault, fenced as data not instructions. |
| `cohort_propose` | Run proposed records through the server-enforced write gate. |
| `cohort_status` | Report the effective policy summary and pending state. |
| `cohort_policy_get` | Return the caller's effective, read-only policy limits. |

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
dependency. The suite connects an in-memory client to the server and asserts that
exactly the four tools register and that each returns its stub response.

## Security

The server is the only trusted component in Cohort. From the first real tool
onward it enforces consent against the vault's `policy.yml`, scans every write for
secrets, and fences loaded memory as data, not instructions. This scaffold adds no
network calls and no file writes; it only lists tools and returns stub responses.
The runtime dependency surface is deliberately small: the MCP SDK and zod, both
pinned, with a committed lockfile and an audit step.

## License

Apache-2.0. Part of [magnusmage/cohort](https://github.com/magnusmage/cohort).
