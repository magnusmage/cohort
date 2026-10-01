# ADR-0016: Bootstrap mode and the plug-and-play pack

- Status: accepted
- Date: 2026-10-02
- Author: Sarmad

## Context

Before this decision, installing Cohort was a developer task: clone the
repo, run `scripts/setup.sh` by hand, copy the connector into a skills
directory, and authenticate `gh` yourself. The docs described that path
well and no other. For everyone else, the gap between "I heard about
this" and "my team vault is running" was too wide, and every rough edge
in it was a support question waiting to happen.

## Decision

1. **Bootstrap mode.** On first invocation with no vault configured,
   the connector walks the user through setup in conversation, in this
   fixed order: disclaimer gate, GitHub auth, repo creation, tooling
   fetch at the pinned release tag, the setup wizard, then push and
   collaborator reminder. `scripts/setup.sh` remains the tested spine;
   the connector drives it and never reimplements its steps.
2. **Disclaimer gate.** Shown in chat before anything runs, verbatim:

   > Before we start, here is exactly what Cohort does:
   > It reads your team's shared vault files into this chat, so your AI has team context.
   > It contacts only your own vault's git remote. Nothing else: no telemetry, no analytics, no third-party servers.
   > The Cohort project runs no servers and keeps no copy of your data. Your data lives in your repo, owned by you.
   > A local scan blocks secrets (API keys, tokens, private data) from ever being committed.
   > Nothing is written without your explicit approval.
   > Your GitHub token is stored only in your computer's credential manager, never in files or chat.
   > Continue?

   No wording deviations without founder sign-off. A short version lives
   in the README under "What it does with your data".
3. **Auth walkthrough.** `gh auth login` with the OAuth browser flow is
   the default. The fallback is a fine-grained PAT limited to Contents
   and Pull requests, one repository, 90-day expiry. The token goes to
   the machine's git credential manager only: the user pipes it into
   `gh auth login --with-token` at their own terminal. A token pasted
   into chat matches the existing redaction rules; the flow refuses and
   the token must be rotated.
4. **Installer.** `install.sh` pins the release tag, requires an
   annotated tag, verifies the skill file's checksum, copies the
   connector skill to the user scope (`~/.kimi-code/skills/cohort/`), and
   runs nothing else. It supports both `curl ... | sh` and
   download-then-read-then-run.
5. **README, two paths only.** "Everyone": one install command, then
   `/skill:cohort` and "set up my team vault". "Developers": the manual
   clone, `setup.sh`, skills-copy, `gh auth` path. Schema internals stay
   in `docs/`, linked from the README.

## Consequences

- The Kimi connector (`connectors/kimi/SKILL.md`) gains the Bootstrap
  section; its `spec_version` becomes 0.2.0.
- `install.sh` embeds the checksum of `connectors/kimi/SKILL.md`.
  Changing the skill file requires updating the checksum before release;
  this is a release-checklist item.
- The pinned tag in `install.sh`, the README install command, and the
  bootstrap tooling fetch all name the same release tag; bumping it is
  part of every release.
- The setup wizard stays the single tested implementation of vault
  seeding, consent capture, rule provisioning, and hook install. The
  connector and the installer both defer to it.
