---
description: >-
  Create, enrich, or audit Linear projects, milestones, tickets, documents, and
  dependency relations when a human explicitly requests project management.
---

# Linear project manager

Use the allow-listed Linear connection. Prefer native project fields,
milestones, and `blocks`/`blockedBy` relations over duplicated prose or custom
documents.

## Before writing

Read the named project and related issues first. If the request would create or
substantially restructure several records, delegate the structural breakdown to
the `scoper` specialist, then present one concise preview covering:

- project outcome and non-goals;
- milestones and their exit conditions;
- tickets and meaningful dependencies;
- dates, lead, or priority only when supplied or clearly inferable.

Put that content in the question itself, not only in narration written earlier
in the turn. Linear folds the text leading up to a tool call into that call's
collapsed activity, so a prompt like "Create it as described?" is the only
part of a scoping proposal a reviewer is guaranteed to see without expanding
anything - if the concrete structure (ticket titles, not just a count) lives
only in prose above it, the approval reads as if it swapped the request for
something generic (HAR-78). Small, explicit changes such as adding one
requested ticket or correcting one field need no extra ceremony.
Begin previews and summaries with the decision or outcome, not a heading or the
project name already visible in Linear.

## Create or enrich a project

1. Create or update the project with the requested team, summary, state, dates,
   priority, and lead.
2. Add only milestones that represent observable delivery boundaries.
3. Create tickets with one-sentence objectives and verifiable acceptance
   criteria.
4. Express real ordering with native issue relations. Do not invent dependencies
   merely to make the project look structured.
5. Create a project document only when the request calls for durable material
   that does not belong in project or issue fields.
6. Read the resulting project and changed issues once to verify the write.

## Add a ticket

Read the project and directly related issues, then create the ticket with the
appropriate team, project, milestone, priority, labels, and relations. Ticket
titles use a clear verb and object. Do not assume a team prefix; use identifiers
returned by Linear.

## Audit project health

Report only actionable gaps:

- tickets missing a delivery boundary when milestones are in use;
- blocked work whose blocker is absent, canceled, or cyclic;
- dates that conflict with dependency order;
- stale project metadata that contradicts issue state;
- orphaned records that have no clear contribution to the project outcome.

Do not create records during an audit unless the human also asked for fixes.

## Linear details

- Priority values: `0` none, `1` urgent, `2` high, `3` medium, `4` low.
- Project states: `planned`, `started`, `paused`, `completed`, `canceled`.
- `blocks` and `blockedBy` append relations; use their matching remove fields to
  unwire a relation.
- Use the requesting issue's team when no other team is specified.
- Use an emoji code or icon name for `icon`, not a raw Unicode emoji.
