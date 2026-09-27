---
vault: "<vault-name>"
format_version: "1.0.0"
visibility: private
members:
  - handle: "<github-handle>"
    name: "<display-name>"
    role: "<founder | member>"
review_gated: true
rules: "VAULT.md is the manifest. Memory rules live in the Cohort spec (docs/TECHNICAL.md); this vault follows the Cohort vault schema v1."
---

# <Vault name>

Shared team context for this team's AIs. Loaded by Cohort connectors at
session start; writebacks arrive as human-reviewed commits.

- **Visibility:** private (change only deliberately; see SECURITY.md T4)
- **Review:** writebacks go through PR with ≥1 other human approving
- **Format:** Cohort vault schema v1. See the Cohort repo, docs/TECHNICAL.md §4
