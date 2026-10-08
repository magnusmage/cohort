# Limitations

Honest limits of the current version. Every one of these is a deliberate
trade-off, and overturning any of them requires a spec change and review.

## Platform limits

- **Kimi Chat (web) and other chats without disk access are consume-only.**
  They have no local disk access and no git, so the connector cannot run
  there. A teammate can upload vault files to a chat project as reference
  material, but nothing syncs back automatically.
- **Two connectors exist.** Kimi Code CLI and ZCode. Claude and ChatGPT
  connectors are planned; until they ship, a mixed team shares the vault
  but only the Kimi and ZCode sides sync automatically.
- **Slash-command quality depends on the host.** Skills are instructions,
  not code. Connector behavior can drift between model versions, which is
  why `metadata.tested_versions` is mandatory.

## Sync and consistency limits

- **Near-real-time, not real-time.** Teammates see each other's writebacks
  at their next pull. Two people editing the same fact concurrently resolve
  it through ordinary git conflict handling; there is no CRDT magic.
- **The vault grows; the context window does not.** The connector loads
  bounded context (facts, pointers, recent sessions, matched decisions).
  Retrieval is curation plus recency plus tags. There is no semantic search
  in v1.
- **Session summaries are human work in v1.** Distilling session logs into
  `pointers.md` happens at review time, by a person.

## Security limits

- **The redaction scan is a backstop, not a guarantee.** gitleaks catches
  known secret patterns and entropy outliers. It cannot judge whether a
  paragraph is commercially sensitive. Human review remains the control.
- **gitleaks is an external dependency.** It is the single deliberate
  exception to the dependency-free rule, installed by the user, verified by
  hash where possible.
- **Trust is collaborator-granular.** Everyone with repo access can read the
  whole vault. There is no per-topic access control.
- **A compromised collaborator account can inject crafted content.** The
  provenance header and the connector's load-time refusal of crafted
  content reduce the blast radius, but the trust model assumes
  collaborators are who they say they are.

## Scope limits

- **Markdown writeback only.** Files are shared by humans through
  `attachments/`; connectors never commit binaries.
- **No federation.** Public vault discovery, anonymous sharing, and
  cross-org bridging are out of scope.
- **No hosting, no accounts, no telemetry.** If you want a managed memory
  service, Cohort is the wrong tool by design.
