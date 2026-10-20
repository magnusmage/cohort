# cohort-control-plane

The Cohort control plane: a read-only review and audit dashboard over a Cohort
vault, gated by single sign-on. This is the commercial layer. It is a separate
package from the open-core vault, server, and CLI, it depends on them and never
the other way around, and it is optional: a vault works fully without it.

## What it does

- Reads a vault's records and git history and presents a review and audit view
  (counts by status and kind, the writeback history, and per-record provenance).
- Serves that view over HTTP. Every route that exposes vault content is gated by
  the authentication boundary and fails closed; there are no write routes.

## What it never does

- It never writes to the vault. The vault in the team's git is the single source
  of truth, and the dashboard never holds the only copy of the memory.
- The open-core packages never import or depend on this one. An enforcement test
  in `cohort-mcp` keeps that direction one-way.

## Run it

```sh
COHORT_VAULT_DIR=/path/to/vault npm start   # or: node dist/index.js
```

The dashboard listens on `COHORT_CP_PORT` (default 8787). With no identity
provider configured it denies every content route by default; configure single
sign-on to open it (see `sso` in the source).

## Develop

```sh
npm install
npm run build
npm run lint
npm test
npm run audit
```
