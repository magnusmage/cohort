#!/usr/bin/env sh
# Cohort installer: copy the connector skills to the user scope.
#
#   curl -fsSL https://raw.githubusercontent.com/magnusmage/cohort/v0.3.0/install.sh | sh
#
# or download install.sh, read it, then run it. Both do the same.
#
# What it does, and nothing else: clones the pinned release tag, verifies
# the tag is annotated and each skill file's checksum, copies SKILL.md to
# each host's skill folder. It does not run the setup wizard, install
# gitleaks, or touch any vault.
#
# Usage: install.sh [kimi|zcode|claude|all]   (default: all)
#
# Checksum discipline: each hash below is the sha256 of that connector's
# SKILL.md at the pinned tag, with CR stripped so clones on Windows (CRLF
# working trees) verify the same content. kimi is pinned at v0.3.0; the
# zcode and claude hashes are pinned to the content shipping in the next
# release tag.
# Note: main's kimi SKILL.md already differs from the v0.3.0 pin (the
# frontmatter fix landed after the tag), so the release commit that moves
# TAG must recompute BOTH pins or the installer refuses on checksum.
# A mismatch refuses the install; a release that predates a connector
# skips it with a notice, unless that connector was named explicitly on
# the command line.
set -eu

TAG="v0.3.0"
REPO_URL="${COHORT_REPO_URL:-https://github.com/magnusmage/cohort.git}"

KIMI_SKILL_SHA256="91d78523983b1f13d0a81039d728e5e83bc1db5cd7a22248462494cbbf6e2822"
KIMI_SKILLS_DIR="${COHORT_KIMI_SKILLS_DIR:-$HOME/.kimi-code/skills/cohort}"
ZCODE_SKILL_SHA256="b2db2196174711e638313e2bc0f973f490e7fe923d01c15bf7d592ee960bc311"
ZCODE_SKILLS_DIR="${COHORT_ZCODE_SKILLS_DIR:-$HOME/.zcode/skills/cohort}"
CLAUDE_SKILL_SHA256="110c5368be7979fb76f31a56bbfafece5215bcaab1e1921f29681f97b386056c"
CLAUDE_SKILLS_DIR="${COHORT_CLAUDE_SKILLS_DIR:-$HOME/.claude/skills/cohort}"

say() { printf '%s\n' "$*"; }
die() { say "install.sh: error: $*" >&2; exit 1; }

sha256() {
  # sha256sum (Linux, Git Bash) or shasum -a 256 (macOS).
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 | awk '{print $1}'
  else
    die "no sha256 tool found (need sha256sum or shasum)"
  fi
}

# verify_one <name> <src> <want-sha>: checksum-verify one connector.
# Returns 1 when the connector does not exist at the tag; a checksum
# mismatch always dies. Nothing is copied here.
verify_one() {
  NAME="$1"; SRC="$2"; WANT_SHA="$3"
  [ -f "$SRC" ] || return 1
  GOT="$(tr -d '\r' < "$SRC" | sha256)"
  [ "$GOT" = "$WANT_SHA" ] \
    || die "checksum mismatch for $NAME SKILL.md at $TAG (got $GOT, want $WANT_SHA); refusing to install"
}

# copy_one <name> <src> <dest-dir> <next-line>: copy a verified connector.
copy_one() {
  NAME="$1"; SRC="$2"; DEST="$3"; NEXT="$4"
  mkdir -p "$DEST"
  cp "$SRC" "$DEST/SKILL.md"
  say "installed cohort skill to $DEST"
  say "next: $NEXT"
}

WANT="${1:-all}"
case "$WANT" in
  kimi|zcode|claude|all) ;;
  *) die "usage: install.sh [kimi|zcode|claude|all]" ;;
esac

command -v git >/dev/null 2>&1 || die "git is required."

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

say "installing Cohort skills $TAG"
git clone --quiet --depth 1 --branch "$TAG" "$REPO_URL" "$TMPDIR/cohort" \
  || die "could not clone $REPO_URL at tag $TAG"

# Refuse lightweight or missing tags: the release must be an annotated tag.
git -C "$TMPDIR/cohort" rev-parse --verify --quiet "refs/tags/$TAG^{tag}" >/dev/null \
  || die "$TAG is not an annotated tag; refusing to install"

# Phase 1: verify every selected connector BEFORE copying anything, so
# a tampered connector leaves nothing half-installed (fail closed).
KIMI_SRC="$TMPDIR/cohort/connectors/kimi/SKILL.md"
ZCODE_SRC="$TMPDIR/cohort/connectors/zcode/SKILL.md"
CLAUDE_SRC="$TMPDIR/cohort/connectors/claude/SKILL.md"
KIMI_OK=1; ZCODE_OK=1; CLAUDE_OK=1
if [ "$WANT" = all ] || [ "$WANT" = kimi ]; then
  if verify_one kimi "$KIMI_SRC" "$KIMI_SKILL_SHA256"; then KIMI_OK=0; else
    [ "$WANT" = kimi ] && die "connectors/kimi/SKILL.md not found at $TAG"
  fi
fi
if [ "$WANT" = all ] || [ "$WANT" = zcode ]; then
  if verify_one zcode "$ZCODE_SRC" "$ZCODE_SKILL_SHA256"; then ZCODE_OK=0; else
    [ "$WANT" = zcode ] && die "connectors/zcode/SKILL.md not found at $TAG (the ZCode connector ships from the next release tag on)"
  fi
fi
if [ "$WANT" = all ] || [ "$WANT" = claude ]; then
  if verify_one claude "$CLAUDE_SRC" "$CLAUDE_SKILL_SHA256"; then CLAUDE_OK=0; else
    [ "$WANT" = claude ] && die "connectors/claude/SKILL.md not found at $TAG (the Claude connector ships from the next release tag on)"
  fi
fi

# Phase 2: copy only what verified.
if [ "$KIMI_OK" = 0 ]; then
  copy_one kimi "$KIMI_SRC" "$KIMI_SKILLS_DIR" \
    'start Kimi Code CLI and run /skill:cohort, then say "set up my team vault"'
else
  [ "$WANT" = all ] && say "skipped kimi: not present at $TAG"
fi
if [ "$ZCODE_OK" = 0 ]; then
  copy_one zcode "$ZCODE_SRC" "$ZCODE_SKILLS_DIR" \
    'start ZCode and run /cohort, then say "set up my team vault"'
else
  [ "$WANT" = all ] && say "skipped zcode: not present at $TAG (ships from the next release tag on)"
fi
if [ "$CLAUDE_OK" = 0 ]; then
  copy_one claude "$CLAUDE_SRC" "$CLAUDE_SKILLS_DIR" \
    'start Claude Code and run /cohort, then say "set up my team vault"'
else
  [ "$WANT" = all ] && say "skipped claude: not present at $TAG (ships from the next release tag on)"
fi
