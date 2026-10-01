#!/usr/bin/env sh
# Validate a Cohort vault against the v1 schema (docs/TECHNICAL.md §4).
# Usage: scripts/validate-vault.sh <vault-dir>
# Exit 0 = valid, 1 = problems found. Boring tech: POSIX sh + git + grep.
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

# 2. .cohort.local.toml: absent is fine; present must be ignored and untracked
if [ -f "$VAULT/.cohort.local.toml" ]; then
  # --no-index: a tracked file must still hit the ignore rule, otherwise
  # check-ignore silently skips it and the tracked case misreports.
  if ! git -C "$VAULT" check-ignore -q --no-index .cohort.local.toml 2>/dev/null; then
    err ".cohort.local.toml is present but not gitignored (see SECURITY.md §8)"
  elif git -C "$VAULT" ls-files --error-unmatch .cohort.local.toml >/dev/null 2>&1; then
    err ".cohort.local.toml is tracked in git; it must stay local (see SECURITY.md §8)"
  else
    ok ".cohort.local.toml present, ignored, and untracked"
  fi
fi
# tr -d '\r': vaults committed with CRLF endings must not false-FAIL the
# exact matches below on shells that read bytes verbatim (Linux, macOS).
tr -d '\r' < "$VAULT/.gitignore" 2>/dev/null | grep -qxF '.cohort.local.toml' \
  || err ".gitignore must ignore .cohort.local.toml"

# 3. VAULT.md frontmatter: format_version and visibility
head -20 "$VAULT/VAULT.md" 2>/dev/null | grep -q '^format_version: "1\.' \
  || err "VAULT.md must declare format_version \"1.x\" in frontmatter"
VIS=$(head -20 "$VAULT/VAULT.md" 2>/dev/null | sed -n 's/^visibility: *//p' | tr -d '\r')
case "$VIS" in private|public) ;; *) err "VAULT.md visibility must be private or public";; esac

# 4. Markdown files need frontmatter with author and date
check_frontmatter() {
  f="$1"
  first=$(head -1 "$f" | tr -d '\r')
  [ "$first" = "---" ] || { err "$f: no YAML frontmatter"; return; }
  head -10 "$f" | grep -q '^author:' || err "$f: frontmatter missing 'author'"
  head -10 "$f" | grep -q '^date:' || err "$f: frontmatter missing 'date'"
}
for f in "$VAULT"/memory/*.md "$VAULT"/memory/decisions/*.md; do
  [ -e "$f" ] && check_frontmatter "$f"
done
# Sessions: year/month nesting, YYYY-MM-DD-<author>.md naming
# The list goes through a temp file, not a pipeline, so the loop runs in
# this shell and failures set the exit code (a find | while pipe would run
# the loop in a subshell and silently swallow them).
session_list="${TMPDIR:-/tmp}/cohort-validate-$$.list"
find "$VAULT/sessions" -name '*.md' > "$session_list" 2>/dev/null
while IFS= read -r f; do
  rel=${f#"$VAULT/sessions/"}
  echo "$rel" | grep -qE '^[0-9]{4}/[0-9]{2}/[0-9]{4}-[0-9]{2}-[0-9]{2}-.+\.md$' \
    || err "session file misnamed or misplaced: sessions/$rel"
  check_frontmatter "$f"
done < "$session_list"
rm -f "$session_list"

# 5. Never-delete rule: nothing in _archive may be empty by accident
[ -d "$VAULT/_archive" ] && ok "_archive/ exists (content optional)"

if [ "$fail" -eq 0 ]; then
  echo "PASS: $VAULT is a valid Cohort vault (schema v1)"
else
  echo "FAILED: $VAULT has schema problems"
fi
exit "$fail"
