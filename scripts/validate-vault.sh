#!/usr/bin/env sh
# Validate a Cohort vault against the v1 schema (docs/TECHNICAL.md §4).
# Usage: scripts/validate-vault.sh <vault-dir>
# Exit 0 = valid, 1 = problems found. Boring tech: POSIX sh + grep only.
set -u

VAULT="${1:-}"
fail=0
err() { printf 'FAIL: %s\n' "$*"; fail=1; }
ok()  { printf 'ok:   %s\n' "$*"; }

[ -n "$VAULT" ] && [ -d "$VAULT" ] || { echo "usage: validate-vault.sh <vault-dir>"; exit 2; }

# 1. Required files and directories
[ -f "$VAULT/VAULT.md" ] || err "VAULT.md missing"
[ -f "$VAULT/memory/facts.md" ] || err "memory/facts.md missing"
[ -f "$VAULT/memory/pointers.md" ] || err "memory/pointers.md missing"
[ -d "$VAULT/memory/decisions" ] || err "memory/decisions/ missing"
[ -d "$VAULT/sessions" ] || err "sessions/ missing"
[ -f "$VAULT/.vaultignore" ] || err ".vaultignore missing"
[ -d "$VAULT/_archive" ] || err "_archive/ missing"
[ -f "$VAULT/.gitignore" ] || err ".gitignore missing"

# 2. .cohort.local.toml must never be trackable
if [ -f "$VAULT/.cohort.local.toml" ]; then
  err ".cohort.local.toml exists in vault (it belongs to the user's local config, never in the tree)"
fi
grep -qxF '.cohort.local.toml' "$VAULT/.gitignore" 2>/dev/null \
  || err ".gitignore must ignore .cohort.local.toml"

# 3. VAULT.md frontmatter: format_version and visibility
head -20 "$VAULT/VAULT.md" 2>/dev/null | grep -q '^format_version: "1\.' \
  || err "VAULT.md must declare format_version \"1.x\" in frontmatter"
VIS=$(head -20 "$VAULT/VAULT.md" 2>/dev/null | sed -n 's/^visibility: *//p')
case "$VIS" in private|public) ;; *) err "VAULT.md visibility must be private or public";; esac

# 4. Markdown files need frontmatter with author and date
check_frontmatter() {
  f="$1"
  first=$(head -1 "$f")
  [ "$first" = "---" ] || { err "$f: no YAML frontmatter"; return; }
  head -10 "$f" | grep -q '^author:' || err "$f: frontmatter missing 'author'"
  head -10 "$f" | grep -q '^date:' || err "$f: frontmatter missing 'date'"
}
for f in "$VAULT"/memory/*.md "$VAULT"/memory/decisions/*.md; do
  [ -e "$f" ] && check_frontmatter "$f"
done
# Sessions: year/month nesting, YYYY-MM-DD-<author>.md naming
find "$VAULT/sessions" -name '*.md' | while IFS= read -r f; do
  rel=${f#"$VAULT/sessions/"}
  echo "$rel" | grep -qE '^[0-9]{4}/[0-9]{2}/[0-9]{4}-[0-9]{2}-[0-9]{2}-.+\.md$' \
    || err "session file misnamed or misplaced: sessions/$rel"
  check_frontmatter "$f"
done

# 5. Never-delete rule: nothing in _archive may be empty by accident
[ -d "$VAULT/_archive" ] && ok "_archive/ exists (content optional)"

if [ "$fail" -eq 0 ]; then
  echo "PASS: $VAULT is a valid Cohort vault (schema v1)"
else
  echo "FAILED: $VAULT has schema problems"
fi
exit "$fail"
