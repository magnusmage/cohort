# Cohort

> Shared context for AI chatbots. One markdown vault on GitHub. Every teammate's AI, regardless of account, plan, or platform, reads and writes the same memory.

[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![Status](https://img.shields.io/badge/status-Phase%201%20(Build)-blue)](docs/TECHNICAL.md)

---

## The problem

Three people work on the same product. Each has their own AI subscription: separate accounts, separate contexts, separate memory. When one person teaches their AI a decision, the other two AIs stay ignorant. Knowledge gets re-explained forever, and context dies in individual chat histories.

## The idea

A git repository is the shared brain. A teammate's AI loads the vault at session start, uses it as context while working, and proposes new knowledge back at session end. A human reviews the proposal, like a pull request. Once merged, every teammate's AI sees it on their next pull.

- GitHub is the trust model. You share your vault the same way you share code: with collaborators you trust.
- Markdown is the format. No proprietary database, no lock-in, human-readable forever.
- Open source, free forever. No payment system, no hosted service required.

## How it works

```
  teammate A's AI --loads-->  +-------------+  <--loads--  teammate B's AI
                              |  vault/     |
  teammate C's AI --loads-->  |  . memory/  |
                              |  . sessions/|
     writeback proposals      |  . attachm. |   writeback proposals
           (PR reviewed)      +------+------+    (PR reviewed)
                                     |
                               git remote (GitHub)
```

## Status

Phase 1: vault spec and the Kimi connector. The repo contains the vault
template, a synthetic example vault, the first connector, the setup wizard,
and the public spec. The security model and the connector spec live in
[docs/TECHNICAL.md](docs/TECHNICAL.md) and [docs/SECURITY.md](docs/SECURITY.md).

## Documentation

| Document | Contents |
|---|---|
| [docs/QUICKSTART.md](docs/QUICKSTART.md) | Shared team memory in about 10 minutes |
| [docs/TECHNICAL.md](docs/TECHNICAL.md) | The spec: architecture, vault schema, connector contract |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model, redaction rules, consent model |
| [docs/USE-CASES.md](docs/USE-CASES.md) | Who Cohort is for, and who it is not for |
| [docs/LIMITATIONS.md](docs/LIMITATIONS.md) | Honest limits of the current version |
| [CHANGELOG.md](CHANGELOG.md) | Release history |

Translations: English first. Chinese translations will follow once the
English docs stabilize.

## Repository layout

```
├── connectors/kimi/     The Kimi connector (SKILL.md, Agent Skills standard)
├── vault-template/      Blank vault scaffold (copy it into your own private repo)
├── example-vault/       Synthetic demo vault (CC0, all content fictional)
├── scripts/             Setup wizard and vault validator
├── security/            Versioned gitleaks redaction rules
└── docs/                The public spec
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Commits use Conventional Commits and
DCO sign-off (`git commit -s`). Security issues: please report privately via
GitHub private vulnerability reporting, not public issues.

## License and authorship

Apache-2.0 for code, CC BY 4.0 for docs, CC0 for example vault content.
Created and maintained by [Sarmad](https://github.com/evdatsion). See
[CITATION.cff](CITATION.cff) for citation metadata.
