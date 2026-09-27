# Changelog

All notable changes to this project. Human-written summaries only, per
project policy.

## [0.1.0] - 2026-09-28

First public release of the protocol and tooling.

- Vault schema v1: `VAULT.md` manifest, `memory/` (facts, decisions,
  pointers), append-only `sessions/`, optional human-managed `attachments/`,
  `.vaultignore`, `_archive/`.
- Consent-first client config: activation scope, writeback mode, and content
  types chosen at setup, stored in a gitignored local file. No
  autonomous-write mode exists.
- Kimi connector (`connectors/kimi/SKILL.md`): load at session start,
  human-approved writeback at session end, gitleaks redaction gate, fail
  closed on secrets, schema violations, and injection patterns.
- Setup wizard (`scripts/setup.sh`): vault init from template, visibility
  choice, consent questions, pre-commit redaction hook.
- Vault validator (`scripts/validate-vault.sh`) and CI workflow running the
  redaction scan and schema validation on every push and PR.
- Synthetic example vault (CC0) and blank vault template.
- Public spec: TECHNICAL.md, SECURITY.md, QUICKSTART.md, USE-CASES.md,
  LIMITATIONS.md.
