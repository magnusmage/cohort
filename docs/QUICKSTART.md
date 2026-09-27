# Quickstart: shared team memory in about 10 minutes

This walks one person through creating a vault, then adding a teammate.
Everything happens in your own GitHub account. Cohort never sees your vault.

## What you need

- git, and a GitHub account
- A Kimi Code CLI installation (the first connector runs there)
- gitleaks (the redaction scanner): https://github.com/gitleaks/gitleaks

## Step 1: create your vault repo

```sh
git clone https://github.com/magnusmage/cohort.git
cp -R cohort/vault-template my-vault
cd my-vault
git init -b main
```

Create a **private** repository named `my-vault` on GitHub, then:

```sh
git add -A && git commit -m "chore: init cohort vault"
git remote add origin git@github.com:<you>/my-vault.git
git push -u origin main
```

## Step 2: run the setup wizard

```sh
sh ../cohort/scripts/setup.sh
```

The wizard asks three questions (activation scope, writeback mode, content
types), writes them to `.cohort.local.toml` (gitignored, local only), sets
your vault visibility, and installs the pre-commit redaction hook. If
gitleaks is missing, the hook refuses every commit until you install it, on
purpose.

Edit `VAULT.md`: set the vault name, and add yourself under `members:`.

## Step 3: install the connector

```sh
mkdir -p .agents/skills
cp -R ../cohort/connectors/kimi .agents/skills/cohort
```

## Step 4: load and propose

Start Kimi Code CLI in the vault directory and invoke the connector:

```
/skill:cohort load the vault
```

You should see the provenance header and your (empty) vault context. Work on
something, then:

```
/skill:cohort propose a writeback
```

The connector drafts new facts and open threads. You edit, approve, or
reject. On approval it runs the redaction scan, commits as you, and pushes.

## Step 5: add a teammate

On GitHub: repo Settings, Collaborators, add your teammate. That is the
entire sharing mechanism. They clone, run the same setup, and their AI loads
the same vault on the next pull. Writebacks from either of you flow through
PRs if you keep `review_gated: true` in `VAULT.md`.

## Verify

```sh
sh ../cohort/scripts/validate-vault.sh .
```

Should print `PASS`. If you forked the vault template and broke the schema,
this is the first thing a teammate's connector will notice too.
