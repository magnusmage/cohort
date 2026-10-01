# Changelog

All notable changes to this project. Human-written summaries only, per
project policy.

## [Unreleased]

Hardening pass over the first round of dogfood findings, then a
pre-release audit pass over every shipping surface.

### Added

- Email and phone patterns in the redaction ruleset, scoped to vault
  content paths, implementing the stricter-public promise of SECURITY.md
  section 3. Mandatory for public vaults.
- The example vault now ships its copy of `security/redaction-rules.toml`.
- `VAULT.md` manifest fields are pinned in the spec: `name`, and the
  optional `review_gated` boolean, which is the single documented signal
  that routes writebacks through pull requests.
- Writeback authorship is pinned as human-only: `author:` is the
  approving human, and no AI or tool names appear in vault frontmatter,
  vault content, or git history.
- The validator requires the pinned `VAULT.md` manifest keys `name:` and
  `members:` (TECHNICAL.md §4). Previously a vault missing them passed as
  valid.
- CI validates `vault-template/` against the schema, not only the example
  vault; the wizard copies the template into every new vault.
- Plug-and-play pack (ADR-0016): bootstrap mode in the Kimi connector
  (verbatim disclaimer gate, GitHub auth walkthrough with OAuth default
  and scoped-PAT fallback, repo creation, then the setup wizard driven
  as the tested spine), `install.sh` (pinned tag, annotated-tag and
  checksum verification, copies the skill to the user scope, runs
  nothing else), and a two-path README with a daily-use table.

### Fixed

- The pre-commit redaction hook scans staged content (`gitleaks protect
  --staged`). The previous `gitleaks git --pre-commit` scanned zero
  commits in a fresh vault and let every commit through.
- The setup wizard captures answers from REPLY instead of command
  substitution, so prompt text no longer leaks into the saved config
  values.
- The setup wizard initializes vaults on the `main` branch
  (`git init -b main`, with a fallback for git older than 2.28),
  matching what the docs already promised.
- The setup wizard accepts a freshly cloned empty repository: a
  directory containing only `.git` now counts as empty and receives the
  template copy.
- The visibility choice now also updates the `VAULT.md` body bullet, not
  just the frontmatter.
- The example and template manifests used `vault:` for the vault name;
  the pinned key is `name:`.
- The validator fails session files that are not named
  `YYYY-MM-DD-<author>.md` under `sessions/YYYY/MM/`.
- The validator and the wizard tolerate CRLF line endings in vault files;
  on shells that read bytes verbatim, a CRLF vault false-failed the
  frontmatter and visibility checks.
- Re-running the wizard no longer overwrites a vault's customized
  `security/redaction-rules.toml`; vault-local rules win.
- The pre-commit hook refuses when the vault lacks its own
  `security/redaction-rules.toml` instead of silently borrowing an
  adjacent checkout's rules.
- Connector spec: the missing `.cohort.local.toml` refusal (offer the
  setup choices) and the `.vaultignore` pre-staging check are stated
  explicitly.

### Changed

- Load now requires the vault to be its own git repository; a connector
  refuses to pull when the vault path resolves into a parent repo. The
  verification notes path-form normalization on Windows/MSYS.
- Connector install notes: when the project is the vault, the connector
  directory is excluded via `.git/info/exclude`, never the vault's own
  `.gitignore`.
- The provenance header is quoted verbatim and identically in
  TECHNICAL.md, SECURITY.md, and the reference connector.
- Session recall is pinned at the 5 most recent sessions, and the v1
  context budget is defined as that bounded set (a configurable token
  budget is post-v1 scope).
- CONTRIBUTING.md records the shell pitfalls found while dogfooding
  (`check-ignore --no-index`, `$0` path derivation, piped exit codes).
- SECURITY.md and LIMITATIONS.md name the prompt-injection control
  accurately: connector load-time refusal of crafted content, not a
  standalone scanner.
- TECHNICAL.md §6a covers the bootstrap flow alongside the three consent
  questions (ADR-0016); SECURITY.md §8 records the token-storage
  commitment.
- README: two paths (one-command install for everyone, manual path for
  developers); schema internals moved to `docs/`, linked.
- CI pins `actions/checkout` to a full-length commit SHA (SECURITY.md
  T6).

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
