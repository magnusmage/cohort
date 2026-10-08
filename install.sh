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
# Usage: install.sh [kimi|zcode|all]   (default: all)
#
# Checksum discipline: each hash below is the sha256 of that connector's
# SKILL.md at the pinned tag, with CR stripped so clones on Windows (CRLF
# working trees) verify the same content. kimi is pinned at v0.3.0; the
# zcode hash is pinned to the content shipping in the next release tag.
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
ZCODE_SKILL_SHA256="cf68f095a96b22e41a1ce2b0aa0133ae6bd67a913edde1c67b316dbc6308e832"
ZCODE_SKILLS_DIR="${COHORT_ZCODE_SKILLS_DIR:-$HOME/.zcode/skills/cohort}"

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

# install_one <name> <src> <dest-dir> <want-sha> <next-line>
# Copies one connector after checksum verification. Returns 1 when the
# connector does not exist at the tag; a checksum mismatch always dies.
# POSIX sh has no locals: these names must not collide with the caller's.
install_one() {
  NAME="$1"; SRC="$2"; DEST="$3"; WANT_SHA="$4"; NEXT="$5"
  [ -f "$SRC" ] || return 1
  GOT="$(tr -d '\r' < "$SRC" | sha256)"
  [ "$GOT" = "$WANT_SHA" ] \
    || die "checksum mismatch for $NAME SKILL.md at $TAG (got $GOT, want $WANT_SHA); refusing to install"
  mkdir -p "$DEST"
  cp "$SRC" "$DEST/SKILL.md"
  say "installed cohort skill to $DEST"
  say "next: $NEXT"
}

WANT="${1:-all}"
case "$WANT" in
  kimi|zcode|all) ;;
  *) die "usage: install.sh [kimi|zcode|all]" ;;
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

if [ "$WANT" = all ] || [ "$WANT" = kimi ]; then
  if install_one kimi \
      "$TMPDIR/cohort/connectors/kimi/SKILL.md" "$KIMI_SKILLS_DIR" \
      "$KIMI_SKILL_SHA256" \
      'start Kimi Code CLI and run /skill:cohort, then say "set up my team vault"'; then
    :
  elif [ "$WANT" = kimi ]; then
    die "connectors/kimi/SKILL.md not found at $TAG"
  else
    say "skipped kimi: not present at $TAG"
  fi
fi

if [ "$WANT" = all ] || [ "$WANT" = zcode ]; then
  if install_one zcode \
      "$TMPDIR/cohort/connectors/zcode/SKILL.md" "$ZCODE_SKILLS_DIR" \
      "$ZCODE_SKILL_SHA256" \
      'start ZCode and run /cohort, then say "set up my team vault"'; then
    :
  elif [ "$WANT" = zcode ]; then
    die "connectors/zcode/SKILL.md not found at $TAG (the ZCode connector ships from the next release tag on)"
  else
    say "skipped zcode: not present at $TAG (ships from the next release tag on)"
  fi
fi
