#!/usr/bin/env bash
# Build the Cohort Claude Desktop extension (.mcpb).
#
# It vendors the published cohort-mcp npm package into server/node_modules so the
# bundle is self-contained, validates the manifest, and packs a single .mcpb that
# a user installs in Claude Desktop with one click. No secrets, no network calls
# at runtime beyond the user's own git remote.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"

echo "Vendoring cohort-mcp into the bundle..."
( cd "$here/server" && npm install --omit=dev )

echo "Validating manifest..."
npx -y @anthropic-ai/mcpb validate "$here/manifest.json"

echo "Packing..."
npx -y @anthropic-ai/mcpb pack "$here" "$here/cohort.mcpb"

echo "Built: $here/cohort.mcpb"
