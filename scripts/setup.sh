#!/usr/bin/env sh
# Cohort vault setup wizard (Phase 1).
# Initializes a vault from vault-template/, records the user's three consent
# choices locally, sets visibility, and installs the pre-commit redaction hook.
# Boring tech on purpose (TECHNICAL.md P5): POSIX sh + git only.
set -eu

TEMPLATE_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)/vault-template"

say()  { printf '%s\n' "$*"; }
# The prompt goes to stderr so callers can read the answer from REPLY
# without command substitution capturing the prompt text.
ask()  { printf '%s [%s]: ' "$1" "$2" >&2; IFS= read -r REPLY; REPLY=${REPLY:-$2}; }

command -v git >/dev/null 2>&1 || { say "error: git is required."; exit 1; }

say "=== Cohort vault setup ==="
say "Your vault is YOUR git repository. This wizard never contacts anything"
say "except your own git remote. You choose the visibility, the access list"
say "(via GitHub collaborators), and how the connector may behave."

# --- 1. Vault location ---------------------------------------------------
ask "Vault directory (created from vault-template if empty)" "./vault"
VAULT_DIR=$REPLY
if [ ! -d "$VAULT_DIR" ]; then
  mkdir -p "$VAULT_DIR"
fi
if [ -z "$(ls -A "$VAULT_DIR" 2>/dev/null)" ]; then
  cp -R "$TEMPLATE_DIR"/. "$VAULT_DIR"/
  say "initialized $VAULT_DIR from vault-template"
fi
[ -f "$VAULT_DIR/VAULT.md" ] || { say "error: $VAULT_DIR/VAULT.md missing; not a Cohort vault."; exit 1; }

cd "$VAULT_DIR"

# --- 2. git repo ---------------------------------------------------------
if [ ! -d .git ]; then
  git init -q
  say "git repository initialized"
fi

# --- 3. Visibility (declared in VAULT.md, drives redaction strictness) ---
ask "Visibility: private or public (public enables stricter redaction + filename review)" "private"
VIS=$REPLY
case "$VIS" in private|public) ;; *) say "error: visibility must be 'private' or 'public'"; exit 1;; esac
# Portable in-place edit of the visibility line in VAULT.md frontmatter.
sed "s/^visibility:.*/visibility: $VIS/" VAULT.md > VAULT.md.tmp && mv VAULT.md.tmp VAULT.md
say "VAULT.md visibility set to: $VIS"

# --- 4. The three consent choices (ADR-0004) -----------------------------
ask "Activation scope: 'session' (act only when you invoke the connector) or 'project' (auto-load in this project)" "session"
SCOPE=$REPLY
case "$SCOPE" in session|project) ;; *) say "error: scope must be 'session' or 'project'"; exit 1;; esac

ask "Writeback mode: 'ask' (propose only when you request) or 'auto-draft' (draft at session end; you still approve every commit)" "ask"
MODE=$REPLY
case "$MODE" in ask|auto-draft) ;; *) say "error: mode must be 'ask' or 'auto-draft'"; exit 1;; esac

ask "Content types: 'text' (markdown only) or 'text+files' (also read vault attachments)" "text"
CONTENT=$REPLY
case "$CONTENT" in text|text+files) ;; *) say "error: content must be 'text' or 'text+files'"; exit 1;; esac

cat > .cohort.local.toml <<EOF
# Cohort client config, per-user and local only. NEVER commit (see SECURITY.md §8).
activation_scope = "$SCOPE"
writeback_mode   = "$MODE"
content_types    = "$CONTENT"
vault_visibility = "$VIS"   # informational copy; VAULT.md is authoritative
EOF

# Ensure it is gitignored (fail-closed check lives in the connector).
grep -qxF '.cohort.local.toml' .gitignore 2>/dev/null || echo '.cohort.local.toml' >> .gitignore
say "wrote .cohort.local.toml (gitignored)"

# --- 5. Pre-commit redaction hook ----------------------------------------
HOOK=.git/hooks/pre-commit
cat > "$HOOK" <<'EOF'
#!/usr/bin/env sh
# Cohort redaction gate: fails the commit closed on any scan hit (SECURITY.md §3).
RULES="$(git rev-parse --show-toplevel)/security/redaction-rules.toml"
[ -f "$RULES" ] || RULES="$(git rev-parse --show-toplevel)/../security/redaction-rules.toml"
if command -v gitleaks >/dev/null 2>&1; then
  gitleaks git --pre-commit --config "$RULES" --verbose
else
  echo "cohort: gitleaks not found; install it (https://github.com/gitleaks/gitleaks)" >&2
  echo "cohort: refusing to commit without the redaction scan (fail closed)." >&2
  exit 1
fi
EOF
chmod +x "$HOOK"
if command -v gitleaks >/dev/null 2>&1; then
  say "pre-commit redaction hook installed (gitleaks found)"
else
  say "pre-commit hook installed, but gitleaks is NOT on your PATH."
  say "Install it or every commit will be refused: https://github.com/gitleaks/gitleaks"
fi

# --- 6. attachments/ only when files are wanted --------------------------
if [ "$CONTENT" = "text" ] && [ -d attachments ]; then
  say "(keeping attachments/; you chose 'text', so the connector will not read it)"
fi

say ""
say "=== Done. Next steps ==="
say "1. Review $VAULT_DIR/VAULT.md and set your vault name and members."
say "2. Create a private GitHub repo and: git remote add origin <url> && git push -u origin main"
say "3. Add teammates as collaborators on GitHub. That IS the sharing mechanism."
say "4. Install the connector: connectors/kimi/SKILL.md (see its install notes)."
