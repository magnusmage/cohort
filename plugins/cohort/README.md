# Cohort shared memory

Give your team's AI one shared memory: a git vault of markdown that every
teammate's AI reads and writes, with a human approving every change. This plugin
bundles the `cohort` MCP server and a skill that tells Claude when and how to use
it.

## Use it

Open your team's vault folder as the project, then ask to load team context (the
skill calls `cohort_load`). As you work, ask Claude to remember a decision or
fact; it proposes a record that is held for your approval (`cohort_propose`), and
you approve it from the terminal with `cohort verify`. Search with
`cohort_search`, and ask why a record exists with `cohort_why`. Promotion and
retirement are human-only, so the model can propose and read but never approve.

## Data

Everything runs on your machine. The server reads and writes your own git vault
and makes no network call beyond your git remote. There is no account and no
telemetry; the maintainers never receive your data. The bundled server is a
local program, so it works in Claude Code and in desktop Cowork sessions, not in
web chat, which cannot run local programs.
