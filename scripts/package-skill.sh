#!/usr/bin/env sh
# Cohort skill packager: zip a connector skill with SKILL.md at the
# archive root, for release assets.
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

OUT="cohort-$TOOL_DIR-skill-v$VERSION.zip"
rm -f "$OUT"
ROOT="$(pwd)"

# -j flattens paths so SKILL.md sits at the archive root. The v1 kimi
# skill is a single file; revisit if a skill ships supporting files.
if command -v zip >/dev/null 2>&1; then
  ( cd "$SRC" && zip -q -j "$ROOT/$OUT" SKILL.md )
elif command -v powershell >/dev/null 2>&1; then
  DEST="$ROOT/$OUT"
  command -v cygpath >/dev/null 2>&1 && DEST="$(cygpath -w "$DEST")"
  ( cd "$SRC" && powershell -NoProfile -Command "Compress-Archive -Path SKILL.md -DestinationPath '$DEST'" )
else
  echo "package-skill.sh: error: need zip or powershell to build the archive" >&2
  exit 1
fi

echo "wrote $OUT"
