#!/usr/bin/env sh
# Cohort skill packager: zip a connector skill as <skill-name>/SKILL.md,
# for release assets and platform skill uploaders that expect a folder.
# Usage: scripts/package-skill.sh <tool-dir> <version>
# Output: cohort-<tool>-skill-v<version>.zip in the current directory.
set -eu

TOOL_DIR="${1:-}"
VERSION="${2:-}"
if [ -z "$TOOL_DIR" ] || [ -z "$VERSION" ]; then
  echo "usage: package-skill.sh <tool-dir> <version>" >&2
  exit 2
fi

SRC="connectors/$TOOL_DIR"
[ -f "$SRC/SKILL.md" ] || { echo "package-skill.sh: error: $SRC/SKILL.md not found" >&2; exit 1; }

SKILL_NAME=$(sed -n 's/^name: *//p' "$SRC/SKILL.md" | head -1 | tr -d '"')
[ -n "$SKILL_NAME" ] || { echo "package-skill.sh: error: no name: in $SRC/SKILL.md frontmatter" >&2; exit 1; }

OUT="cohort-$TOOL_DIR-skill-v$VERSION.zip"
ROOT="$(pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# LF content in the archive: take the blob from git when this is a
# checkout (autocrlf must not leak CRLF into the upload), else strip CR.
mkdir -p "$STAGE/$SKILL_NAME"
if git rev-parse --git-dir >/dev/null 2>&1; then
  git show "HEAD:$SRC/SKILL.md" | tr -d '\r' > "$STAGE/$SKILL_NAME/SKILL.md"
else
  tr -d '\r' < "$SRC/SKILL.md" > "$STAGE/$SKILL_NAME/SKILL.md"
fi

rm -f "$OUT"
if command -v zip >/dev/null 2>&1; then
  ( cd "$STAGE" && zip -q -r "$ROOT/$OUT" "$SKILL_NAME" )
elif command -v powershell >/dev/null 2>&1; then
  DEST="$ROOT/$OUT"
  command -v cygpath >/dev/null 2>&1 && DEST="$(cygpath -w "$DEST")"
  ( cd "$STAGE" && powershell -NoProfile -Command "Compress-Archive -Path '$SKILL_NAME' -DestinationPath '$DEST'" )
else
  echo "package-skill.sh: error: need zip or powershell to build the archive" >&2
  exit 1
fi

echo "wrote $OUT"
