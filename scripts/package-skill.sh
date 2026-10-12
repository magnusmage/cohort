#!/usr/bin/env sh
# Cohort skill packager: zip a connector skill as <skill-name>/SKILL.md,
# for release assets and platform skill uploaders that expect a folder.
# Usage: scripts/package-skill.sh <tool-dir> <version>
# Output: cohort-<tool>-skill-v<version>.zip in the current directory.
#
# Byte-exactness: SKILL.md goes into the archive straight from the git
# object store via git archive. It never passes through a pipe, a text
# filter, or a shell redirection, so its bytes are the blob's bytes.
# After the build, a fail-closed check reads the SKILL.md entry back and
# refuses the archive if it contains any CR byte.
set -eu

TOOL_DIR="${1:-}"
VERSION="${2:-}"
if [ -z "$TOOL_DIR" ] || [ -z "$VERSION" ]; then
  echo "usage: package-skill.sh <tool-dir> <version>" >&2
  exit 2
fi

SRC="connectors/$TOOL_DIR"
OUT="cohort-$TOOL_DIR-skill-v$VERSION.zip"

SKILL_NAME=$(sed -n 's/^name: *//p' "$SRC/SKILL.md" | head -1 | tr -d '"')
[ -n "$SKILL_NAME" ] || { echo "package-skill.sh: error: no name: in $SRC/SKILL.md frontmatter" >&2; exit 1; }

command -v git >/dev/null 2>&1 || { echo "package-skill.sh: error: git is required" >&2; exit 1; }
git rev-parse --git-dir >/dev/null 2>&1 || { echo "package-skill.sh: error: must run inside the Cohort checkout" >&2; exit 1; }
git rev-parse --verify --quiet "HEAD:$SRC/SKILL.md" >/dev/null \
  || { echo "package-skill.sh: error: $SRC/SKILL.md not tracked at HEAD" >&2; exit 1; }

rm -f "$OUT"
# Byte-exactness: archive straight from the git object store. git for
# Windows smudges CRLF into archive entries under core.autocrlf=true,
# so disable it for this run. (The zip container itself is not
# sha-stable across rebuilds: tree-ish archives stamp entries with the
# build time. SKILL.md content is byte-exact and matches the pinned
# installer checksum; verify content, not the container.)
git -c core.autocrlf=false archive --format=zip --prefix="$SKILL_NAME/" -o "$OUT" "HEAD:$SRC"

# Fail closed: the archived SKILL.md must not contain a single CR byte.
# Byte-count comparison, because MSYS grep strips CR from piped input
# and cannot be trusted for this. A scanner that cannot verify refuses.
ENTRY="$SKILL_NAME/SKILL.md"
command -v unzip >/dev/null 2>&1 \
  || { echo "package-skill.sh: error: unzip is required to verify the archive" >&2; rm -f "$OUT"; exit 1; }
RAW=$(unzip -p "$OUT" "$ENTRY" 2>/dev/null | wc -c | tr -d ' ')
NORAW=$(unzip -p "$OUT" "$ENTRY" 2>/dev/null | tr -d '\r' | wc -c | tr -d ' ')
if [ -z "$RAW" ] || [ "$RAW" = "0" ] || [ "$RAW" != "$NORAW" ]; then
  echo "package-skill.sh: error: archived SKILL.md missing or contains CR bytes; refusing to ship it" >&2
  rm -f "$OUT"
  exit 1
fi

# Fail closed: only documented frontmatter keys may ship. The host
# uploaders reject unknown keys, which is how a CR-free but
# non-conformant skill still fails in the field (see the v0.3.0 saga).
FM_ALLOWLIST='^(---|name:|description:|type:|whenToUse:|when_to_use:|when-to-use:|disableModelInvocation:|disable-model-invocation:|disable_model_invocation:|arguments:)'
FM_VIOLATIONS=$(unzip -p "$OUT" "$ENTRY" 2>/dev/null | sed -n '2,/^---$/p' | grep -vE "$FM_ALLOWLIST" | grep -c . || true)
if [ "$BAD_KEYS" != "0" ]; then
  echo "package-skill.sh: error: SKILL.md frontmatter carries keys outside the documented host schema; refusing to ship it" >&2
  rm -f "$OUT"
  exit 1
fi

echo "wrote $OUT"
