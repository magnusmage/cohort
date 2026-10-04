# Quickstart: shared team memory in about 10 minutes

This walks one person through creating a vault, then adding a teammate.
Everything happens in your own GitHub account. Cohort never sees your vault.

## Which Kimi is this for?

| Kimi product | Connector runs? | Notes |
|---|---|---|
| Kimi Code CLI | Yes | The primary target. Install the skill, invoke with `/skill:cohort`. |
| Kimi Work desktop | Yes | Attach the vault folder as the workspace; the same instructions apply. |
| Kimi Chat (web) | No | No local disk or git. A teammate can export vault files into a Kimi Chat Project as read-only reference; nothing syncs back, and the install commands will not run there. |

**How you start it:**

| Product | How you start the Cohort skill |
|---|---|
| Kimi Code CLI | Type `/skill:cohort` in the chat input, or just ask in plain language ("set up my team vault") and the model loads it for you. |
| Kimi Work desktop | Type `/` in the chat input and pick Cohort from the Skills menu, or describe the task in plain language and Kimi Agent triggers it. |

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
