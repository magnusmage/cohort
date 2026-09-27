# TECHNICAL.md, the Cohort spec (vault format v1)

## 1. Problem statement

AI chatbots keep context per account and per session. Teams whose members
hold separate subscriptions have no way to share decisions, facts, and
workflow preferences between their AIs. Existing memory products (Mem0,
Letta, Zep, and the MCP memory servers) target agent builders through APIs
and MCP. Nothing open, git-native, and human-readable targets teams using
chatbots directly.

## 2. Design principles

| # | Principle | Consequence |
|---|---|---|
| P1 | Markdown-first | Every artifact is a `.md` file a human can read and edit in any editor. No binary formats, no proprietary database. |
| P2 | Git-native | Git is the sync engine, audit log, and conflict-resolution layer. We build zero infrastructure. |
| P3 | Human-in-the-loop writeback | AIs propose knowledge; humans approve via PR. No autonomous writes to shared memory. |
| P4 | Platform-agnostic | The vault format contains nothing platform-specific. Connectors adapt platforms to the vault, never the reverse. |
| P5 | Boring tech | Shell scripts + markdown + git. Any contributor can audit everything. No servers, no vector databases, no build step for v1. |
| P6 | Fail closed | On any doubt (secrets detected, injection suspected, malformed file), the connector refuses to sync and tells the human why. |

## 3. System architecture

```
+------------------------- teammate's machine -------------------------+
|                                                                      |
|   +------------+   load   +----------------+                        |
|   | AI chatbot | <------- |   connector    |                        |
|   | (Kimi 1st) | -------> |  (SKILL.md)    |                        |
|   +------------+  propose +-------+--------+                        |
|                                   | git pull/push                   |
|                          +--------v--------+                        |
|                          |  vault/ (repo)  |                        |
|                          |  . memory/      |                        |
|                          |  . sessions/    |                        |
|                          |  . attachments/ |                        |
|                          +--------+--------+                        |
+------------------------------------+-----------------------------------+
                                     |  push / PR / merge
                           +---------v---------+
                           |  git remote       |
                           |  (GitHub, any)    |
                           +---------+---------+
                                     | pull
          +--------------------------+--------------------------+
          v                          v                          v
   teammate B                 teammate C                 ...anyone
   (any platform)            (any platform)             trusted
```

## 4. Vault schema (v1)

```
vault/
├── VAULT.md                 Vault manifest: name, members, rules, format version
├── memory/
│   ├── facts.md             Long-lived team facts (glossary, stack, constraints)
│   ├── decisions/           One file per decision
│   │   └── 2026-09-25-use-postgres.md
│   └── pointers.md          Current priorities and active threads
├── sessions/
│   └── 2026/09/             Append-only session logs, one file per session
│       └── 2026-09-25-alice.md
├── attachments/             OPTIONAL: user-managed files (PDFs, images).
│                            Humans add these manually via git; connectors
│                            never auto-commit binaries.
├── .vaultignore             Never-sync patterns (secrets, env files, etc.)
├── .cohort.local.toml       Gitignored per-user client prefs (scope, writeback mode)
└── _archive/                Rotated or superseded content, never deleted
```

File format rules:

- All files are UTF-8 markdown with YAML frontmatter (`author`, `date`, `tags`, `supersedes`).
- Session logs are append-only. Git preserves history anyway.
- Decisions are immutable once merged. Superseding a decision creates a new file with a `supersedes:` pointer; nothing is deleted.
- `_archive/` is the only destination for removal. The vault never forgets, it only retires.
- Connectors write markdown only. `attachments/` may hold any file type a human deliberately commits; connectors index and read attachments but never propose them into a writeback.
- `.cohort.local.toml` holds per-user client preferences (activation scope, writeback mode). It must be gitignored and must never be committed.

## 5. Sync lifecycle

Session start (load):

1. The connector runs `git pull` on the vault.
2. It reads `VAULT.md`, checks the format version, and aborts on a major version mismatch.
3. It loads bounded context: `facts.md` + `pointers.md` + the last few session summaries + relevant decisions by tag or recency. Never the whole vault (context-window budget, P6).
4. It injects the context with a clear provenance header: "Shared team context from the Cohort vault, last synced HH:MM."

Session end (propose):

1. The connector drafts a writeback proposal: new facts, decisions made, open threads.
2. It always shows the proposal to the human first. The human edits, approves, or rejects.
3. On approval: write files per schema, run the redaction scan (SECURITY.md), commit with the convention, push. Review-gated teams open a PR instead of pushing directly.

## 6. Connector specification

A connector is a `SKILL.md` skill file following the Agent Skills open
standard (YAML frontmatter + markdown instructions). It must:

| Requirement | Detail |
|---|---|
| Load | Implement the session-start lifecycle above |
| Propose | Implement the session-end lifecycle; never write without approval |
| Respect context budget | Load at or under the configured token budget; summarize old sessions, do not paste them |
| Redact | Apply the redaction rules before any commit |
| Fail closed | Refuse and explain on: secrets detected, schema violation, injection patterns in vault content |
| Declare platform | Frontmatter `metadata.platform`, `metadata.tested_versions` |
| Consent-first activation | Do nothing unless the user invoked the connector or asked about shared team context. Never activate unprompted. |
| Respect client config | Read `.cohort.local.toml` on every run; honor `activation_scope` and `writeback_mode`; refuse to run if the file is missing and offer the setup choices |

### 6a. Client configuration (set once per install, asked by the setup wizard)

Every install answers three questions. Answers are stored locally in
`<vault>/.cohort.local.toml` (gitignored, per-user, never shared):

| Setting | Options | Meaning |
|---|---|---|
| `activation_scope` | `session` (default) / `project` | `session`: the connector acts only when explicitly invoked in that chat. `project`: the connector may auto-load vault context at session start within this project. The user chooses per chat and per project; nothing propagates on its own. |
| `writeback_mode` | `ask` (default) / `auto-draft` | `ask`: the connector proposes a writeback only when the user requests one. `auto-draft`: the connector drafts a proposal at session end. Both modes require explicit human approval before any commit. There is no autonomous-write option. |
| `content_types` | `text` (default) / `text+files` | `text`: writebacks are markdown-only. `text+files`: the connector may also read vault attachments on request, and the setup wizard creates `attachments/`. It still never auto-commits files. |

The user owns the vault repo, its collaborator list, and these choices. The
connector is a capability; every sharing decision stays human (SECURITY.md §8).

## 7. Context budget and retrieval strategy

The vault grows; the context window does not. The strategy, in order of preference:

1. Curated summaries: session logs get distilled into `pointers.md` at review time (humans do this in v1).
2. Recency + tags: load recent and tag-matched decisions; skip the rest.
3. On-demand read: the connector may fetch specific vault files mid-session when relevant (platform permitting).

Explicit non-goal for v1: embeddings and vector search. We revisit this only if curated summaries demonstrably fail.

## 8. Versioning

- Vault format: semver, declared in `VAULT.md`. Connectors declare their compatible format range.
- Connectors: semver, with a `CHANGELOG.md` per connector.
- Breaking vault changes require a migration note in `docs/migrations/`.

## 9. Non-goals (explicit)

- Real-time sync. Pull-on-start is near-real-time enough by design.
- Hosted services, accounts, anything server-side.
- Monetization, payments, seat management.
- Vector databases, embeddings, agent frameworks.
- Autonomous writeback without human approval.
- More than one platform connector per release phase.
