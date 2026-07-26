---
description: >-
  Draft or post a grounded Linear project status update when a human requests
  an update or a Linear project reminder fires.
---

# Linear project update

Write a concise update grounded in Linear and recent merged GitHub pull
requests. Match the user's request: draft only when asked for a draft; post when
explicitly asked to post.

## Gather

Use the named project. If none is available, list active projects and ask the
human to choose.

Read in parallel:

- the project with milestones;
- its issues and blocking relations;
- prior project status updates;
- merged pull requests from the last seven days with `gh pr list`.

If GitHub is unavailable, continue from Linear and disclose that omission. Use
actual ticket identifiers from Linear rather than assuming a team prefix.

## Synthesize

Determine:

- what shipped since the last update;
- what is in progress;
- what is blocked and by which ticket;
- the next meaningful delivery boundary;
- health: `onTrack`, `atRisk`, or `offTrack`.

Use `onTrack` when delivery is progressing without a material blocker,
`atRisk` when a known blocker or likely slip needs attention, and `offTrack`
when a deadline has already been missed or delivery is broadly blocked.

## Write

Lead with the outcome, then use only the sections that help:

```markdown
## Project name - concise status

One or two sentences on what changed and why it matters.

**Shipped**
- TICKET-ID - outcome

**In flight**
- TICKET-ID - current delivery

**Blocked**
- TICKET-ID - blocked by TICKET-ID

**Next**
One sentence on the next boundary.
```

Omit empty sections. Use exact counts and ticket identifiers, plain English,
active voice, and at most one relevant emoji in the heading.

When asked to draft, return the proposed body and recommended health without
posting. When asked to post, call `save_status_update` and return its Linear URL.
For an ambiguous request, show the draft and ask whether to post.
