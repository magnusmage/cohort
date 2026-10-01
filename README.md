# Cohort

> Shared context for AI chatbots. One markdown vault on GitHub. Every teammate's AI, regardless of account, plan, or platform, reads and writes the same memory.

![License](docs/badge-license.svg)
![Status](docs/badge-status.svg)

![Cohort architecture: teammates' AI clients load bounded context from the shared vault repo, and propose writebacks back through a local redaction gate, human approval, and a review-gated pull request. No servers exist.](docs/architecture.svg)

---

## What it is

Cohort gives a team shared memory for their AI chatbots. One git repository holds the team's facts, decisions, and open threads in plain markdown. Each teammate's AI reads a bounded slice at session start and proposes updates at session end, and a human approves every change before it lands. There are no servers and no accounts with us: the repo is the product, and it lives in your GitHub.

## How to start

### Everyone

Install the connector (verifies the pinned release tag, then copies the skill into place):

```sh
curl -fsSL https://raw.githubusercontent.com/magnusmage/cohort/v0.2.0/install.sh | sh
```

Prefer to read installer scripts first? Download it, read it, run it. Same result:

```sh
curl -fsSLO https://raw.githubusercontent.com/magnusmage/cohort/v0.2.0/install.sh
less install.sh
sh install.sh
```

Then start Kimi Code CLI, run `/skill:cohort`, and say "set up my team
vault". The connector states exactly what it does with your data,
waits for your yes, and walks you through GitHub auth, creating your
vault repo, and three consent choices. Nothing is written without your
approval at each step.

### Developers

```sh
git clone https://github.com/magnusmage/cohort.git   # the tooling and spec
sh cohort/scripts/setup.sh                           # seeds a vault, asks consent, installs the redaction hook
cp -R cohort/connectors/kimi ~/.kimi-code/skills/cohort   # installs the connector skill
gh auth login                                        # GitHub auth for repo creation and PRs
```

### Daily use

| You want | You do |
|---|---|
| Team context at session start | Run `/skill:cohort` (or let it auto-load when you chose project scope) |
| Save a decision, fact, or open thread | Ask the connector to propose a writeback; edit and approve the draft |
| Add a teammate | Add them as a GitHub collaborator on the vault repo. That is the entire sharing mechanism |

## Where to read more

- [Cohort, explained](docs/EXPLAINED.md): the loop, every command, the consent choices, the security model in one page
- [The spec](docs/TECHNICAL.md): architecture, vault schema, connector contract
- [The security model](docs/SECURITY.md): threat model, redaction rules, consent model
- [Ten-minute walkthrough](docs/QUICKSTART.md)
- [Who it is for](docs/USE-CASES.md) and [honest limits](docs/LIMITATIONS.md)
- [Decision records](docs/decisions/) and [release history](CHANGELOG.md)

## Repository layout

```
├── connectors/kimi/     The Kimi connector (SKILL.md, Agent Skills standard)
├── vault-template/      Blank vault scaffold (copied into your own repo)
├── example-vault/       Synthetic demo vault (CC0, all content fictional)
├── scripts/             Setup wizard and vault validator
├── security/            Versioned gitleaks redaction rules
├── install.sh           Pinned-tag installer for the connector skill
└── docs/                The public spec, decision records, the diagram
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Commits use Conventional Commits and
DCO sign-off (`git commit -s`). Security issues: please report privately via
GitHub private vulnerability reporting, not public issues.

## License and authorship

Apache-2.0 for code, CC BY 4.0 for docs, CC0 for example vault content.
Created and maintained by [Sarmad](https://github.com/evdatsion). See
[CITATION.cff](CITATION.cff) for citation metadata.
