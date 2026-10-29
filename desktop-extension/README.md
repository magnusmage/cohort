# Cohort as a Claude Desktop extension (.mcpb)

This builds a one-click Claude Desktop install for Cohort. A user double-clicks a
`.mcpb` file, picks their vault folder, and the `cohort-mcp` server is wired into
Claude Desktop with no terminal.

The bundle is self-contained: it vendors the published `cohort-mcp` npm package
and runs it over stdio. It makes no network call beyond the user's own git
remote, keeps no account, and sends no telemetry, the same promise as the rest
of Cohort.

## Build it

```sh
bash desktop-extension/build.sh
```

That vendors `cohort-mcp` into `server/node_modules`, validates `manifest.json`,
and writes `desktop-extension/cohort.mcpb`. The `.mcpb` and `node_modules` are
git-ignored; only the source (manifest, `server/package.json`, this script) is
committed, so the bundle is reproducible.

Requirements: Node.js and npm. The MCPB CLI is fetched on demand via `npx`.

## Install it (as a user)

Any one of these, in Claude Desktop:

- Double-click `cohort.mcpb`.
- Drag and drop it into the Claude Desktop window.
- Settings → Extensions → Advanced settings → Install Extension, then pick the file.

The install screen asks for your **vault folder** (the git folder holding your
team's memory). That path is passed to the server as `COHORT_VAULT_DIR`. Each
teammate installs it on their own machine and points it at their clone of the
same vault repo.

## Distribute it

Attach the built `cohort.mcpb` to a GitHub Release so teammates can download and
double-click it. Keep its `version` in `manifest.json` in step with the
`cohort-mcp` version in `server/package.json`, and rebuild when either changes.

## How this relates to the browse directories

- The **MCP Registry** (`registry.modelcontextprotocol.io`) already lists
  `io.github.magnusmage/cohort-mcp`, which is the cross-client catalog.
- Claude Desktop's own extension directory no longer accepts `.mcpb`
  submissions. To appear in Claude's browsable directory, the server is packaged
  inside a Claude **plugin** and that plugin is submitted. This `.mcpb` is for
  direct, one-click install and private distribution.
