# The open-core boundary

Cohort is open core. The memory and everything needed to run it are free and
open source under Apache-2.0, forever. A separate commercial control plane may
be built on top for teams that want hosting and administration, but the memory
is never the thing you pay for, and the open-core components never depend on the
commercial ones.

This page is the boundary. It exists so the line stays bright as the project
grows, and so no change quietly moves a capability from the free side to the
paid side.

## What is open core (Apache-2.0)

These are the product. They are licensed Apache-2.0, they live in this
repository, and they run fully on your own machine and your own GitHub with no
account with us and no network call beyond your git remote:

- The vault: the markdown record format, the `.cohort/policy.yml` schema, the
  vault template, and the example vault.
- The policy engine and the write gate: consent resolution, the secret and PII
  scan, the instruction linter, contradiction detection, and the merge guard.
- The `cohort-mcp` server and all of its tools (`cohort_load`, `cohort_propose`,
  `cohort_status`, `cohort_policy_get`, `cohort_search`, `cohort_why`).
- The `cohort` CLI (`init`, `verify`, `supersede`, `stats`, `index`, `bridge`,
  `reabsorb`, `export`, `import`).
- The retrieval index, token-budgeted retrieval, staleness and supersession, and
  the portable export and import format.
- The installer and the client connectors.

Documentation is licensed CC BY 4.0 (see `docs/LICENSE.md`).

## What may be commercial (the control plane)

A commercial control plane is offered as a separate, optional layer. Its
reference implementation lives in `control-plane/` as its own package, clearly
outside the open-core packages. It covers:

- A hosted review and audit dashboard.
- Single sign-on and identity for that dashboard.
- Multi-tenant hosting and administration.

The control plane reads a team's vault to present review and audit; it never
writes to the vault, never holds the only copy of the memory, and a team can
stop using it at any time with their full vault intact in their own git. It
depends on the open-core artifacts; the open-core packages never depend on it.

## The rule

No open-core component may depend on, import, require, or need a commercial
component to function. Concretely:

- The vault, the server, and the CLI must build, test, and run with nothing but
  this repository and its open-source dependencies.
- A commercial component may read the open-core artifacts (the vault, the
  server's output); the open-core artifacts may not read a commercial one.
- If a feature cannot be built without the control plane, it does not belong in
  the open-core packages.

An enforcement test in `cohort-mcp` fails the build if an open-core source file
imports from a commercial namespace, and asserts the package stays Apache-2.0,
so this rule is checked, not just written down.
