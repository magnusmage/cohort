# Cohort

> Shared context for AI chatbots. One markdown vault on GitHub. Every teammate's AI, regardless of account, plan, or platform, reads and writes the same memory.

[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![Status](https://img.shields.io/badge/status-Phase%201%20(Build)-blue)](docs/TECHNICAL.md)

---

## What it does with your data

Cohort keeps no servers and no copy of your data; everything lives in your own repo. It contacts only your git remote, sends no telemetry, blocks secrets before every commit, and never writes without your approval.

## For everyone

One command installs the connector:

```sh
curl -fsSL https://raw.githubusercontent.com/magnusmage/cohort/v0.2.0/install.sh | sh
```

Prefer to read installer scripts before running them? Same result:

```sh
curl -fsSLO https://raw.githubusercontent.com/magnusmage/cohort/v0.2.0/install.sh
less install.sh
sh install.sh
```

Then start Kimi Code CLI, run `/skill:cohort`, and say "set up my team
vault". The connector shows a short statement of exactly what it does
with your data, then walks you through GitHub auth, creating your vault
repo, and three consent choices. Nothing is written without your
approval at each step.

### Daily use

| You want | You do |
|---|---|
| Team context at session start | Run `/skill:cohort` (or let it auto-load when you chose project scope) |
| Save a decision, fact, or open thread | Ask the connector to propose a writeback; edit and approve the draft |
| Add a teammate | Add them as a GitHub collaborator on the vault repo. That is the entire sharing mechanism |

## For developers

```sh
git clone https://github.com/magnusmage/cohort.git
sh cohort/scripts/setup.sh        # seeds a vault, asks consent, installs the redaction hook
cp -R cohort/connectors/kimi ~/.kimi-code/skills/cohort
gh auth login
```

The manual path also works with a project-scope install (`.kimi-code/skills/cohort`) or the shared `.agents/skills/cohort/` path; see the install notes in `connectors/kimi/SKILL.md`.

## How it works

A git repository is the shared brain. Each teammate's AI loads a bounded
slice of the vault at session start (facts, current pointers, recent
sessions, matched decisions), works with it as context, and proposes
new knowledge back at session end. A human reviews every proposal; with
`review_gated: true` in `VAULT.md` the writeback ships as a pull
request. Once merged, every teammate's AI sees it on the next pull.

The vault schema, the connector contract, and the trust model live in
[docs/TECHNICAL.md](docs/TECHNICAL.md) and
[docs/SECURITY.md](docs/SECURITY.md). Design decisions are recorded in
[docs/decisions/](docs/decisions/).

## Status

Phase 1: vault spec and the Kimi connector. The repo contains the vault
template, a synthetic example vault, the first connector, the setup
wizard, a pinned-tag installer, and the public spec.

## Documentation

| Document | Contents |
|---|---|
| [docs/QUICKSTART.md](docs/QUICKSTART.md) | Shared team memory in about 10 minutes |
| [docs/TECHNICAL.md](docs/TECHNICAL.md) | The spec: architecture, vault schema, connector contract |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model, redaction rules, consent model |
| [docs/USE-CASES.md](docs/USE-CASES.md) | Who Cohort is for, and who it is not for |
| [docs/LIMITATIONS.md](docs/LIMITATIONS.md) | Honest limits of the current version |
| [docs/decisions/](docs/decisions/) | Architecture decision records |
| [CHANGELOG.md](CHANGELOG.md) | Release history |

Translations: English first. Chinese translations will follow once the
English docs stabilize.

## Repository layout

```
├── connectors/kimi/     The Kimi connector (SKILL.md, Agent Skills standard)
├── vault-template/      Blank vault scaffold (copied into your own repo)
├── example-vault/       Synthetic demo vault (CC0, all content fictional)
├── scripts/             Setup wizard and vault validator
├── security/            Versioned gitleaks redaction rules
├── install.sh           Pinned-tag installer for the connector skill
└── docs/                The public spec and decision records
```

The example vault ships without a client config on purpose: a connector
refuses to LOAD until `scripts/setup.sh` (or you, manually) writes a
gitignored `.cohort.local.toml` into it (TECHNICAL.md §6a).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Commits use Conventional Commits and
DCO sign-off (`git commit -s`). Security issues: please report privately via
GitHub private vulnerability reporting, not public issues.

## License and authorship

Apache-2.0 for code, CC BY 4.0 for docs, CC0 for example vault content.
Created and maintained by [Sarmad](https://github.com/evdatsion). See
[CITATION.cff](CITATION.cff) for citation metadata.
