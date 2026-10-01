# Cohort, explained

The plain-language companion to the README. One page of detail for
people who want it, before they dive into the spec.

## The loop in one paragraph

At the start of a session, your AI loads a small, bounded slice of the
vault: the team facts, the current pointers, the five most recent
session summaries, and any decisions that match what you are working
on. It works with that context and proposes new knowledge back at the
end of the session: facts learned, decisions made, threads still open.
Every proposal is shown to a human first. After approval, a local scan
checks the files for secrets, and the writeback ships: a direct commit
on a solo vault, or a pull request when the vault is review-gated.
Everyone else sees it on their next pull. Nothing writes without a
human saying yes, and no AI or tool name ever appears in the vault.

## Commands

| Command | What it does | When you run it |
|---|---|---|
| `curl -fsSL .../install.sh \| sh` | Installs the connector skill to `~/.kimi-code/skills/cohort/`. Verifies the pinned release tag and the skill's checksum first; runs nothing else. | Once per machine |
| `sh scripts/setup.sh` | Seeds a vault from the template, asks the visibility choice and the three consent questions, provisions the redaction rules, installs the pre-commit hook. | Once per vault |
| `sh scripts/validate-vault.sh <dir>` | Checks a vault against the v1 schema: required files, manifest keys, frontmatter, session naming, local config discipline. Exit 0 means valid. | Anytime, before pushing |
| `gh auth login` | Authenticates the GitHub CLI with the OAuth browser flow. A fine-grained PAT is the fallback; the token goes to the credential manager only. | Once per machine |
| `gitleaks protect --staged` | The redaction gate. Scans staged files against the vault's rules and refuses the commit on any hit. Normally runs inside the pre-commit hook. | Every commit, automatically |
| `/skill:cohort` | Invokes the connector in Kimi Code CLI: load context, or propose a writeback. | Daily |

## The consent choices

The setup wizard asks three questions. Each answer is stored in the
vault's gitignored `.cohort.local.toml`, per user, never shared.

| Choice | Options | What it means |
|---|---|---|
| Activation scope | `session` (default) or `project` | `session`: the connector acts only when you invoke it in that chat. `project`: it may auto-load vault context at session start in that project. Nothing turns itself on. |
| Writeback mode | `ask` (default) or `auto-draft` | `ask`: proposes a writeback only when you request one. `auto-draft`: drafts one at session end. Both still stop for your approval before any commit. |
| Content types | `text` (default) or `text+files` | `text`: writebacks are markdown only. `text+files`: the connector may also read vault attachments when you ask. It never commits files, in any mode. |

## The security model in one page

- **Trust is collaborator-granular.** Only GitHub collaborators of the
  vault repo can read or write. Adding a teammate is a collaborator
  grant; removing one is a revocation.
- **Every writeback is human-approved.** Solo vaults self-approve;
  review-gated vaults (`review_gated: true` in `VAULT.md`) require a
  second human's PR approval.
- **A local scan gates every commit.** The vault carries its own
  gitleaks rules: API keys, tokens, private keys, credentialed URLs,
  high-entropy strings, plus stricter email and phone rules in public
  vaults. A hit refuses the commit and names the rule. A missing
  scanner also refuses. Fail closed everywhere.
- **Vault content is data, not instructions.** Loaded context arrives
  under a provenance header that tells the AI to treat it as history,
  and the connector refuses to load files that look crafted to
  manipulate it.
- **Your token stays on your machine.** The GitHub token lives in the
  credential manager only. Never in chat, never in a file, never in
  the vault.
- **No servers.** Cohort runs no infrastructure and keeps no copy of
  anyone's data. The only network traffic is git pull and push against
  your own remote. There is no telemetry.

## Where the details live

- Vault schema and connector contract: [TECHNICAL.md](TECHNICAL.md)
- Threat model and redaction rules: [SECURITY.md](SECURITY.md)
- Decisions and their reasons: [decisions/](decisions/)
- Ten-minute walkthrough: [QUICKSTART.md](QUICKSTART.md)
