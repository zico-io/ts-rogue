---
description: >-
  Draft and post a Linear project status update backed by a 7-day sweep of
  Linear (milestones, issues, prior updates) and merged GitHub PRs. Use when a
  human asks to write or post a project update, kick off a project, update the
  team on progress, or when a Linear "Reminder to post update for the project"
  fires. Shows a findings sweep, then a confirmed draft, before posting.
---

# Linear Project Update

Drafts and posts a Linear project status update, backed by a 7-day sweep of **Linear** and **merged GitHub PRs** (the only sources this agent is connected to). Always shows a findings block and a draft for review - via the runtime's `ask_question` park - before posting.

## Sources

- **Linear** (`linear` connection): `get_project`, `list_issues`, `get_status_updates`, `list_projects`. Tools stay visible whether this skill is loaded or not.
- **GitHub** merged PRs: run `gh` **inside the agent's sandbox** (`ctx.getSandbox()`), which already carries GitHub auth. Never assume a logged-in host `gh`.

There is no Slack or Notion connection - do not reach for them.

---

## Phase 0 — Project Selection

Prefer the project named in the request. If none is named (a bare "Reminder to post update for the project" carries no project name), list candidates and `ask_question` to pick:

```
list_projects: state=started
```

> Do not filter by `member=me` - under the agent's app-scoped Linear auth the agent is not a project member, so that filter would return nothing. Filter by `state=started` and pick from those.

Do not proceed without a confirmed project.

---

## Phase 1 — Context Sweep

Record `TODAY` and compute `SEVEN_DAYS_AGO = TODAY minus 7 days` (`YYYY-MM-DD`) before sweeping. Fire the independent reads together.

### Linear (3 calls)

```
get_project: query=PROJECT_NAME, includeMilestones=true
list_issues: project=PROJECT_NAME, limit=50
get_status_updates: type=project, project=PROJECT_NAME
```

Extract: milestone names + completion state; ticket statuses (Todo / In Progress / Done / Canceled / Blocked); blocked tickets and their blockers by ID; date of the most recent prior update (or "none" - a first update is a **kickoff**); every ticket identifier (e.g. `HAR-XX`) for GitHub cross-reference. Identifiers are per-team - read them from the response, don't assume a prefix.

### GitHub merged PRs (1 sandbox call)

In the sandbox:

```bash
gh pr list \
  --repo zico-io/ts-rogue \
  --state merged \
  --json title,url,mergedAt,author,body \
  --limit 50
```

Filter to PRs with `mergedAt >= SEVEN_DAYS_AGO`. Cross-reference titles and body text against the ticket IDs from Linear. If the sandbox `gh` call fails (auth or otherwise), skip it and note "GitHub: skipped" in the findings block - do not error out.

---

## Phase 2 — Synthesize (findings block, then confirm)

Compile the findings and present them via `ask_question` before drafting. Be explicit when a source returned zero results - never invent context.

```
Sources consulted (last 7 days):
- Linear: N tickets - X closed, Y in-flight, Z blocked
  Blocked: [HAR-XX blocked by HAR-YY, ...]
  Last update: [YYYY-MM-DD or "none - this is the first update"]
- GitHub: N merged PRs
  Matched to project tickets: [PR title → HAR-XX, ...]
  Unmatched (may be relevant): [titles where the project name appears in the body]

Inferred update type: kickoff | update | done
Inferred health: onTrack | atRisk | offTrack
Reason: [one sentence]
```

Wait for the human to confirm or correct the synthesis before drafting.

---

## Phase 3 — Draft

Apply the matching template. Run the humanization checklist before showing the draft. Present the draft via `ask_question` in a fenced `## Draft` block with your recommended `health` stated above it. Wait for approval or edits.

---

## Phase 4 — Post

On approval:

```
save_status_update:
  type: "project"
  project: PROJECT_NAME
  body: <approved draft>
  health: onTrack | atRisk | offTrack
```

Return the Linear URL.

---

## Templates

### Kick-off

```
## [emoji] [Project Name] is live

[1-2 sentences. What this project produces and why it matters. Outcome first, mechanism second.]

---

**What's in motion**

[One entry per milestone: "**M[N]: Name (TICKET-ID, TICKET-ID)** — one line on what it produces."]
[Note any parallel workstreams explicitly.]

---

**What needs to happen right now**

[Name the keystone ticket by ID. One sentence on why it unblocks everything else. No hedging.]

[Close: "We're on track." — or "Blocked on [TICKET-ID]." if applicable.]
```

### Mid-project update

```
## [Project Name] — [brief progress phrase]

[1 sentence: what moved since the last update.]

---

**Shipped**
[Closed tickets: TICKET-ID — title]
[Merged PRs if relevant: PR title → TICKET-ID]

**In flight**
[Todo / In Progress tickets: TICKET-ID — title]

**Blocked**
[Blocked tickets. Name the specific blocker. Omit the section if none.]

---

**Next**
[1-2 sentences on what opens up or the critical path now.]

[Health close: "On track." / "Watching [X]." / "Blocked on [X]."]
```

### Completion

```
## [emoji] [Project Name] — Done

[1-2 sentences. What shipped and what it does. Lead with the outcome.]

---

**Delivered**
[Per-milestone summary: what each produced, one line.]

---

[Follow-on: "What's next: [one sentence]." Otherwise: "That's a wrap."]
```

---

## Health Mapping

| Situation | `health` |
|-----------|----------|
| Kick-off, no blockers | `onTrack` |
| Active, milestones on schedule | `onTrack` |
| One blocked ticket, others progressing | `atRisk` (flag the ticket ID) |
| Multiple blocked tickets or a milestone slipping | `atRisk` |
| Explicit missed deadline | `offTrack` (name the deadline and what slipped) |
| Systemic problem (scope explosion, blocked team) | `offTrack` |
| Project complete, all milestones closed | `onTrack` (Completion template) |

Rule of thumb: `atRisk` is "we see the problem and are managing it"; `offTrack` is "we've already missed something".

---

## Voice

ts-rogue's internal update register - tight, mechanism-driven, no filler.

- Build → punchline → move on. Lead with outcome, not activity ("X is live", not "We have started X").
- Real numbers earn trust ("4 tickets", "2 weeks") - not "several" or "multiple".
- Name ticket IDs when they orient the reader ("HAR-3 is the keystone").
- Architecture in one sentence.
- "We're on track" only when it's true.
- One emoji in the section heading only - never scattered through the body.
- **Banned openers**: "Excited to share…", "We are pleased to announce…", "In this update…", "As a reminder…".
- **Closes**: short and declarative - "We're on track." / "Blocked on HAR-XX." / "That's a wrap." Aspirational close only when the milestone is genuinely significant.

### Humanization checklist (apply every row before showing a draft)

| Cut | Replace with |
|-----|-------------|
| "I'm excited / pleased to share" | Just state the thing |
| "It's worth noting that" | State it directly |
| "We have been working on" | "In flight:" or "shipped" |
| "was completed", "has been shipped" | "shipped", "done", "closed" |
| leverage, utilize, synergy, robust, seamless, align (verb) | Plain English |
| "there's a dependency" | Name the ticket ID |
| "several / multiple tickets" | The actual number |
| Adjective that adds nothing ("successful launch") | Drop it |
| "In today's world", "more than ever" | Delete |
| Passive ("was reviewed by") | Active ("reviewed") |
| "As previously mentioned" | Say it once; delete callbacks |

---

## Gotchas

- **Reminder has no project name** - the Phase 0 picker is mandatory. Never skip it.
- **First update** - if `get_status_updates` is empty, this is a kickoff. Set type `kickoff` and do not write "since last update".
- **0 results from a source** - say so ("GitHub: 0 merged PRs"). Never pad the draft with invented context.
- **GitHub is sandbox-only** - `gh` runs in the agent's sandbox with its own auth; a failure is skipped and noted, not fatal.
- **Ticket prefixes vary by team** - extract IDs from `list_issues`, don't assume `HAR-`.
