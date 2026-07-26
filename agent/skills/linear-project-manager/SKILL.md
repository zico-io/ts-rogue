---
description: >-
  Scaffold and maintain rich Linear projects with milestones, native blocking
  relationships, project documents, and structured ticket hierarchies. Use when
  a human asks to create a new Linear project, enrich an existing one, add a
  ticket with blocking relations, or audit a project's health.
---

# Linear Project Manager

Patterns and procedures for scaffolding production-grade Linear projects with full metadata, milestones, native issue relationships, and structured ticket hierarchies. Pure Linear - no other services.

Scaffolding or restructuring a project is always a direct response to an explicit human request in a Linear session. A human is present, so gate every irreversible step on the runtime's `ask_question` park: draft, park for approval, iterate, and only write to Linear once approved.

## Tools

All operations use the allow-listed `linear` connection. Tools stay visible whether this skill is loaded or not - no separate load step.

| Tool | Purpose | Key params |
|------|---------|-----------|
| `save_project` | Create/update project (create when no `id`) | `name`, `description`, `summary`, `icon`, `color`, `addTeams`, `startDate`, `targetDate`, `state`, `priority`, `lead`, `labels` |
| `get_project` | Read project | `query` (name/ID), `includeMilestones`, `includeResources`, `includeMembers` |
| `save_milestone` | Create/update milestone | `project` (required), `name`, `description`, `targetDate` |
| `list_milestones` | List project milestones | `project` |
| `save_issue` | Create/update ticket | `title`, `team`, `project`, `parentId`, `priority`, `milestone`, `blocks`, `blockedBy`, `labels`, `links` |
| `get_issue` | Read ticket with relations | `id`, `includeRelations: true` |
| `list_issues` | Query project tickets | `project`, `team`, `limit` |
| `save_document` | Create/update project document | `title`, `project` (parent), `icon`, `content` (Markdown) |
| `create_issue_label` | Create a workspace/team label | `name`, `color`, `description`, `team` |

### Priority values

`0`=None, `1`=Urgent, `2`=High, `3`=Medium, `4`=Low.

### Project states

`planned`, `started`, `paused`, `completed`, `canceled`.

### ts-rogue conventions

- **Teams**: `Harness`, `Web`, `Rogue.ts`, `Engine`, `Terminal`. Put a project's tickets on the team the request targets - default to the requesting issue's team. Do not hardcode one team.
- **Ticket identifiers** are per-team (`HAR-`, `ENG-`, `WEB-`, `RT-`, `TERM-`, …). Never assume a prefix - read the actual identifiers from `list_issues` before referencing them.
- **`icon`** takes an emoji code or icon name (`":sparkles:"`, `"Rocket"`), not a raw Unicode emoji.
- **`blocks`/`blockedBy` are append-only** on `save_issue`; use `removeBlocks`/`removeBlockedBy` to unwire a relation.

---

## Procedure: Scaffold a New Project

### Step -1: Define the Project Axiom (TL;DR)

Before touching any Linear tool, establish the project's core axiom - a compact, approved summary that every downstream decision must trace back to.

**Draft the TL;DR.** If the request carries enough context, draft immediately. Otherwise `ask_question`: "Describe the project in a sentence - what it does and who it's for."

Use this 3-part format:

```
[Concept sentence - what this system/project does, who the actors are, the core mechanism.]

[N] [primitives / sides / jobs]:
- Primitive 1 - what it is or does
- Primitive 2 - what it is or does
- Primitive 3 - what it is or does

[Governing constraint - the invariant that holds the system together. Omit if already in the concept sentence.]
```

Use 2-4 primitives, named the way the team names them in code and conversation.

**Iterate until approved.** Present the draft via `ask_question`: "Is this the right axiom? Revise any part - we won't proceed until this is locked." Incorporate feedback and re-present until the human explicitly approves.

**Gate.** Do not proceed to Step 0 until the TL;DR is approved. Every downstream element - milestones, tickets, documents - must be traceable to a named primitive. If a proposed element can't be traced, flag it as possible scope drift before creating it.

### Step 0: Draft the plan and resolve key decisions

**0a - Show the draft plan** via `ask_question`. Create no Linear records yet.

```
Project: [Name] ([type: Architecture / Feature / Migration / etc.])
Summary: [one line]

Milestones:
  M1: [Name] - [exit condition]
  M2: [Name] - [exit condition]

Tickets (rough):
  M1: [title], [title], ...
  M2: [title], ...

Open decisions:
  1. [Decision question]
  2. [Decision question]
```

If there are no open decisions, say so and wait for the human to confirm the plan.

**0b - Work through decisions one at a time.** `ask_question` each open decision with brief context - why it matters and the realistic options. Wait for the answer before the next. If an answer changes milestone structure or ticket scope, call it out and revise the draft plan inline before continuing. Do not proceed to Step 1 until every decision is resolved or explicitly deferred.

**0c - Record resolved decisions** for the Decision Log (Step 6):

```
Decision: [question]
Answer: [what was decided]
Rationale: [reason given, if any]
```

Resolved decisions go in the Decision Log, not the project description. Only deferred decisions stay under `### Key Decisions to Make`.

### Step 1: Create the project shell

```
save_project:
  name: "Project Name"
  addTeams: ["Harness"]        # the requesting issue's team
  priority: 2
  icon: ":sparkles:"
  color: "#0EA5E9"
  summary: "One-liner (max 255 chars)"
  state: "planned"
```

### Step 2: Write a rich project description

`description` supports full Markdown:

```markdown
## Project Name — Type (Architecture / Feature / Migration / etc.)

### TL;DR
[Approved TL;DR verbatim - concept + primitives + governing constraint from Step -1]

---

### Purpose
1-2 sentences on why this project exists.

### Non-Goals
Explicit exclusions to prevent scope creep.

### Key Decisions to Make
Deferred decisions only. Resolved ones go in the Decision Log.

### Success Criteria
Measurable outcomes that define completion.
```

### Step 3: Set the timeline

```
save_project:
  id: "<project-id>"
  startDate: "YYYY-MM-DD"
  targetDate: "YYYY-MM-DD"
  state: "started"
```

### Step 4: Create milestones

**Axiom check:** each milestone must map to a TL;DR primitive being built, integrated, or validated. If a milestone can't be explained in terms of a named primitive, call it out first.

Design milestones as **dependency groups**, not arbitrary sprints. Each milestone is a phase where all its tickets can run in parallel, and the group's completion unblocks the next phase.

```
save_milestone:
  project: "Project Name"
  name: "M1: Phase Name"
  description: "Exit condition - the single observable state that means this milestone is complete."
  targetDate: "YYYY-MM-DD"
```

Naming: `M{n}: {Phase Name}` (`M1: Foundation Research`, `M2: Schema Design`). Milestone descriptions contain only the exit condition. Ticket lists, parallelism notes, and dependency chains live on the tickets via `blocks`/`blockedBy`, not here.

### Step 5: Create tickets with structure

**Axiom check:** each ticket should trace to a primitive. If a ticket falls outside every named primitive, flag it as potential scope creep and confirm before creating it.

For each ticket:
1. Set `team`, `project`, `parentId` (if a sub-issue), `priority`, `milestone`.
2. **Set `blocks`/`blockedBy`** - Linear's native relations are the canonical source of truth for dependencies. Do not duplicate this in documents or descriptions.
3. Add `labels` for categorization (create missing ones with `create_issue_label`).
4. Write a structured description (template below).

### Step 6: Create project documents

```
save_document:
  project: "Project Name"
  title: "Document Title"
  icon: ":memo:"
  content: "Full Markdown"
```

Recommended: **Decision Log** (pre-populate with the resolved decisions from Step 0c) and **Meeting Notes / Standup Log**.

**Do not create a "Dependency Graph" document.** Dependencies live in native `blocks`/`blockedBy` relations - visible in Linear's UI and queryable via `get_issue` + `includeRelations`. A separate ASCII graph goes stale immediately.

### Step 7: Verify

1. `get_project` with `includeMilestones: true, includeResources: true`.
2. `get_issue` with `includeRelations: true` on a sample of tickets - confirm `blocks`/`blockedBy` are populated correctly.
3. Confirm every milestone has tickets assigned.
4. Confirm the blocking relations form a valid DAG (no cycles) by tracing the relations from step 2.

---

## Procedure: Enrich an Existing Project

1. **Audit**: `get_project` (all includes), `list_issues` for all tickets.
2. **Identify gaps**: missing description, no milestones, no documents, no timeline, tickets without a milestone.
3. **Group by dependency**: analyze `blocks`/`blockedBy` to find natural milestone boundaries.
4. **Apply**: update metadata, create milestones, assign tickets, create documents.
5. **Verify**: Step 7 above.

---

## Procedure: Add a Ticket to an Existing Project

1. `get_project` with milestones to understand structure.
2. `get_issue` with `includeRelations: true` on tickets this one interacts with.
3. Determine milestone placement from its dependencies.
4. Create it:
   ```
   save_issue:
     title: "Verb + object (imperative)"
     team: "Harness"
     project: "Project Name"
     parentId: "<parent-id>"   # if a sub-issue
     priority: 2
     milestone: "M1: Phase Name"
     blocks: ["HAR-XX"]
     blockedBy: ["HAR-ZZ"]
     description: "Structured Markdown (template below)"
   ```
5. Verify: `get_issue` + `includeRelations` on the new ticket.

---

## Procedure: Audit Project Health

1. **List tickets**: `list_issues` for the project.
2. **Milestone coverage**: every ticket assigned to a milestone.
3. **Orphans**: tickets with no `blocks` and no `blockedBy` that aren't in the final milestone.
4. **Cycles**: trace the blocking graph - it must be a DAG.
5. **Stale**: tickets in Backlog that are not blocked (should be Todo / In Progress).
6. **Milestone dates**: ordered chronologically and aligned with dependency flow.
7. **Native relations**: spot-check with `get_issue` + `includeRelations` - do not maintain a separate dependency document.

---

## Ticket Description Template

```markdown
## Objective
One sentence on what this ticket produces and why.

## Acceptance Criteria
- [ ] Verifiable, independently testable outcomes
- [ ] Include "reviewed by X" if review is required
```

For architecture/research tickets, add a **Context** section linking related tickets or prior art. Blocking relationships live on the ticket's native relations, never duplicated in the description text.

---

## Milestone Design Patterns

**Dependency Groups** - group tickets by DAG position; all in a group run in parallel, the group gates the next.
```
M1: Foundation (no blockers, parallel) → M2: Design (blocked by M1) → M3: Synthesis (blocked by M1+M2) → M4: Execution
```

**Phased Rollout** - by feature phase.
```
M1: Core Infrastructure → M2: MVP → M3: Enhancements → M4: Migration & Cleanup
```

**Parallel Workstreams** - independent streams that merge.
```
M1: Shared Foundation → {M2a: Frontend, M2b: Backend} → M3: Integration
```

---

## Icon & Color Reference

Icons (emoji codes): Analytics `:bar_chart:` · Infrastructure `:building_construction:` · Feature `:sparkles:` · Migration `:truck:` · Security `:shield:` · Performance `:zap:` · Docs `:books:` · Design `:art:`. Documents: Decision Log `:memo:` · Meeting Notes `:speech_balloon:` · Architecture `:classical_building:` · Runbook `:notebook:`.

Colors: Indigo `#6366F1` (data) · Emerald `#10B981` (infra) · Amber `#F59E0B` (migration) · Rose `#F43F5E` (security) · Sky `#0EA5E9` (features) · Purple `#8B5CF6` (design) · Slate `#64748B` (maintenance).

---

## Decision Log Template

```markdown
## Decision Log

### YYYY-MM-DD: Decision Title
**Status:** Proposed / Accepted / Superseded
**Context:** Why this was needed
**Decision:** What was decided
**Alternatives:** What else was considered
**Consequences:** What this means for the project
```
