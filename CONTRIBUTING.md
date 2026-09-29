# Contributing to Cohort

Thanks for your interest. Cohort is a small project with strict scope, so
the best contributions early on are connector work, spec clarifications, bug
reports, and dogfood reports from real teams.

## Ground rules

- **Scope:** check the non-goals in `docs/TECHNICAL.md` §9 before proposing
  anything large. Hosted services, payments, and autonomous writeback are
  permanently out of scope.
- **License:** code is Apache-2.0, docs are CC BY 4.0. No CLA; you keep your
  copyright. DCO sign-off is required (`git commit -s`), a simple statement
  that you have the right to submit the work.
- **Code of conduct:** `CODE_OF_CONDUCT.md` applies everywhere.

## Commit style

Conventional Commits: `feat:`, `fix:`, `docs:`, `security:`, `memory:`.
One logical change per commit, message in the imperative.

## Shell script notes

Three pitfalls this project has shipped and fixed; check for them when
editing `scripts/`:

- `git check-ignore` silently skips tracked paths. When checking an ignore
  rule against a file that might be tracked, pass `--no-index`.
- Derive paths from `$0` only before the script changes directory. Capture
  the repo root at the top; a relative invocation (`sh scripts/setup.sh`)
  breaks `$0`-relative lookups after a `cd`.
- Read the exit code of a scanner (gitleaks) from the command itself, never
  from a pipeline: `gitleaks ... | tail` reports `tail`'s status and
  swallows a non-zero gitleaks exit. Route through a temp file instead.

## Pull requests

- One approving review to merge; security-sensitive changes get a security
  review as well.
- CI must pass: the gitleaks scan (`.github/workflows/security.yml`) fails
  the build on any secret pattern, and `scripts/validate-vault.sh
  example-vault` must pass on any schema change.
- Connectors must be plain markdown with no executable payloads and no
  network calls beyond git (see the reviewer checklist in the project
  docs). If you write a connector, follow `connectors/kimi/SKILL.md` as the
  reference implementation.

## Reporting security issues

Never open a public issue for a security problem. Use GitHub private
vulnerability reporting on this repository. See `docs/SECURITY.md` §6.
