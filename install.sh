#!/usr/bin/env sh
# Cohort installer: copy the Kimi connector skill to the user scope.
#
#   curl -fsSL https://raw.githubusercontent.com/magnusmage/cohort/v0.3.0/install.sh | sh
#
# or download install.sh, read it, then run it. Both do the same.
#
# What it does, and nothing else: clones the pinned release tag, verifies
# the tag is annotated and the skill file's checksum, copies SKILL.md to
# ~/.kimi-code/skills/cohort/. It does not run the setup wizard, install
# gitleaks, or touch any vault.
set -eu

TAG="v0.3.0"
REPO_URL="${COHORT_REPO_URL:-https://github.com/magnusmage/cohort.git}"
SKILLS_DIR="${COHORT_SKILLS_DIR:-$HOME/.kimi-code/skills/cohort}"
# sha256 of connectors/kimi/SKILL.md with CR stripped, so clones on
# Windows (CRLF working trees) verify the same content.
SKILL_SHA256="91d78523983b1f13d0a81039d728e5e83bc1db5cd7a22248462494cbbf6e2822"

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

command -v git >/dev/null 2>&1 || die "git is required."

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

say "installing Cohort skill $TAG"
git clone --quiet --depth 1 --branch "$TAG" "$REPO_URL" "$TMPDIR/cohort" \
  || die "could not clone $REPO_URL at tag $TAG"

# Refuse lightweight or missing tags: the release must be an annotated tag.
git -C "$TMPDIR/cohort" rev-parse --verify --quiet "refs/tags/$TAG^{tag}" >/dev/null \
  || die "$TAG is not an annotated tag; refusing to install"

SKILL="$TMPDIR/cohort/connectors/kimi/SKILL.md"
[ -f "$SKILL" ] || die "connectors/kimi/SKILL.md not found at $TAG"

GOT="$(tr -d '\r' < "$SKILL" | sha256)"
[ "$GOT" = "$SKILL_SHA256" ] \
  || die "checksum mismatch for SKILL.md at $TAG (got $GOT, want $SKILL_SHA256); refusing to install"

mkdir -p "$SKILLS_DIR"
cp "$SKILL" "$SKILLS_DIR/SKILL.md"

say "installed cohort skill to $SKILLS_DIR"
say "next: start Kimi Code CLI and run /skill:cohort, then say \"set up my team vault\""
