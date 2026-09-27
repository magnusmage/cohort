# Use cases

Cohort fits teams whose members use separate AI subscriptions. It does not
try to be a personal memory product or an agent framework.

## 1. Small product teams on mixed personal plans

The founding case. Three people build one product; one pays for Kimi, one
for Claude, one for ChatGPT. Today, when one person teaches their AI a
decision ("we use Postgres, and here is why"), the other two AIs never learn
it. With a vault, the decision is written once, reviewed by a human, and
every teammate's AI loads it at the next session start. No one needs an
Enterprise plan or a shared account.

## 2. Open-source project contributors

A maintainer and several contributors work across time zones. Project
conventions, rejected approaches, and pending threads live in the vault
instead of being repeated in every issue and PR. A new contributor's AI
starts with the project's memory on day one, and their first contribution
comes with context instead of a week of archaeology.

## 3. Agencies and freelancers

An agency runs several client projects. Each client gets a vault: brand
rules, stakeholder preferences, past decisions, open threads. Contractors
rotate in and out by collaborator grant and revocation. When a contract
ends, access ends with it, and the client's memory stays in the agency's
repo, not in a contractor's chat history.

## 4. Cross-platform individuals (secondary)

One person using several AIs (Kimi for code, Claude for writing, ChatGPT
for research) can keep a personal vault to carry project context between
them. This works, but the market already has many personal memory tools;
teams are the reason Cohort exists.

## What a writeback looks like in practice

A session ends with the AI proposing: "New fact: the Q4 launch is gated on
the security review, not the feature freeze. New decision: we deferred the
mobile app to Q1. Open thread: pricing page copy still unowned." The human
deletes the third item, approves the rest, and the commit lands. The
teammate's next session starts with exactly that knowledge.

## Anti-use cases (where Cohort is the wrong tool)

- You want real-time sync or live collaboration. Cohort is pull-on-start,
  near-real-time by design.
- You want semantic search over everything. v1 uses curated summaries and
  recency, not embeddings.
- You want AI agents writing to shared memory without review. That is the
  thing Cohort refuses to do on principle.
- Your whole team is on one vendor's enterprise plan with shared memory.
  Use that; Cohort earns its place when accounts are mixed.
