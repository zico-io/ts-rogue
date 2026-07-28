# Eve project agent

Eve takes ts-rogue work from Linear issues to reviewed GitHub pull requests in
Vercel Sandboxes.

## Quick start

Requirements:

- Node.js 24+
- pnpm 10+
- Access to the configured Vercel Connect clients

```bash
pnpm install
pnpm eve:dev
```

Run the full repository gate before handing off changes:

```bash
pnpm check
pnpm exec eve info
```

## How delivery works

The root agent owns ordinary work end to end: it reads the Linear issue, changes
the repository, verifies the result, pushes a branch, and opens a pull request.
It communicates at useful milestones rather than narrating each command.
Human-facing Linear and GitHub prose starts with substance and stays compact.
The harness removes redundant leading Markdown headers because both platforms
already render the project, issue, pull request, author, and activity state.

The declared `playtester` subagent is available when independent terminal or web
verification adds value. The root can also drive the same play scripts directly.
The declared `scoper` subagent runs a stronger Opus model to break a
multi-deliverable request into an approvable breakdown; the root keeps the
approval gate and does every Linear write. Automatic ponytail pull-request review
runs in GitHub Actions through `scripts/ci-review.ts`.

The `Workflow` tool (`tools/workflow.ts`) lets the root orchestrate several
`agent` calls - fan-out, chained results, loop/conditional dispatch - from one
model-authored JavaScript program run as a single durable step, instead of one
model turn per batch of direct `agent` calls. `hooks/workflow-progress.ts`
posts an ephemeral chip for each call a running `Workflow` step dispatches and
a durable chip with its truncated result when it finishes, so a human watching
the Linear Agent Session sees each call as it happens instead of only the
step's final synthesized result.

Parent issues with independently shippable sub-issues use the `handoff` tool.
Each ready sub-issue receives its own Linear Agent Session and predecessor
context. Blocking relations in Linear determine readiness.

## Components

| Path | Responsibility |
| --- | --- |
| `agent.ts` | Root model configuration |
| `instructions.md` | Stable identity, safety boundaries, and delivery contract |
| `channels/` | Eve, Linear, and GitHub message adapters. Translation only: each wraps Eve's own channel with the platform rendering and the one or two route behaviors Eve does not provide (see `WORKAROUNDS.md`). Every decision they render comes from `lib/` |
| `connections/` | Allow-listed Linear and read-only Vercel capabilities |
| `hooks/workflow-progress.ts` | Streams per-call `Workflow` progress to whichever channel owns the session |
| `sandbox/` and `lib/sandbox/` | One Vercel Sandbox recipe shared by the root agent and both subagents, its bootstrap, GitHub network policy and token refresh, and the `ORIENTATION.md` brief |
| `lib/credentials.ts` | The agent's brokered Linear and GitHub identities, shared by channels and tools, plus Linear access-token resolution |
| `lib/session.ts` | `AgentSession`, one turn lifecycle - what the agent says and when - plus `sessionEvents`, the table wiring it to Eve's lifecycle events, and the connect-prompt naming both channels word the same way |
| `lib/channel.ts` | The `ChannelRenderer` contract each channel implements, and `textRenderer`, the shared rendering for channels whose only surface is posted text |
| `lib/linear/` | Everything Linear-only: activity text limits, the out-of-band poster `hooks/workflow-progress.ts` reaches a session through, webhook re-verification for the pre-dispatch decisions, the stop signal and duplicate-session guard, issue workflow transitions, and live-session lookup |
| `lib/github/` | Everything GitHub-only: the wake policy, pull-request state sync and Linear-ref extraction, dispatch prompt text, and the `pull_request_review` delivery eve never dispatches (HAR-49) |
| `lib/turn-report.ts` | Action labels, parameters, results, and error narration for turn-lifecycle reporting |
| `lib/tool-activity.ts` | How a tool call reads as a chip: its label, its parameter, and its result summary |
| `lib/agent-plan.ts` | The `todo` tool's list mapped into an agent plan |
| `lib/memory/` | Eve's runtime memory store: the Connect credential, the libSQL adapter and schema with its retention cap, the `remember`/`recall`/`forget` input schemas, and the untrusted-JSON preamble |
| `instructions/memory.ts` | Dynamic, per-turn instructions loading recent memories as untrusted JSON |
| `skills/` | Optional Eve, Linear project, and README-hygiene procedures |
| `subagents/playtester/` | Independent terminal and web acceptance verification |
| `subagents/scoper/` | Opus-model planner that breaks a multi-deliverable request into an approvable breakdown |
| `tools/handoff.ts` | Starts an informed successor Agent Session |
| `tools/workflow.ts` | Enables the `Workflow` tool to orchestrate `agent` calls as one durable step |
| `tools/session_update.ts` | Posts blocked, review, and completion activities |
| `tools/remember.ts`, `tools/recall.ts`, `tools/forget.ts` | Autonomous read/write access to the runtime memory store |
| `tools/bash.ts`, `tools/web_fetch.ts` | eve's own tools with only `toModelOutput` replaced, so high-volume output stops riding every later round-trip |
| `lib/truncate-for-context.ts` | The head+tail window those two tools show the model; `lib/truncate.ts` is the separate display-only cap for Linear chips |
| `schedules/eve-version-check.ts` | Checks for Eve upgrades and audits framework workarounds |
| `schedules/agent-run-analysis.ts` | Daily review of recent Eve/GitHub/Vercel activity that files Harness issues for real findings |

## Linear and GitHub

Linear owns issue status, priority, dependencies, and Agent Session activities.
The harness moves an issue forward when work starts, a pull request opens, a
pull request merges, or a session fails. These transitions are forward-only and
must not block dispatch when Linear is unavailable.

The custom Linear channel preserves capabilities not exposed together by Eve's
built-in wrapper: immediate cancel-and-steer, stop signals, duplicate-session
protection, Agent Plan synchronization, and lifecycle updates. It also retains
the built-in behavior for verified webhooks, inbound Linear images, activities,
authorization prompts, and proactive sessions.

GitHub pull requests remain the review and merge boundary. The GitHub channel:

- wakes Eve for actionable inline review feedback;
- advances Linear state when pull requests open or merge;
- advances Linear issue groups after a sub-issue merges;
- records unresolved review debt after merges.

Harness changes are also reviewed against
[Linear's Agent Interaction Guidelines](https://linear.app/developers/aig):
agent disclosure, native platform behavior, prompt feedback, visible state,
immediate disengagement, and human accountability. These criteria live once in
the root instructions and are mirrored by the `aig:` lens in
`scripts/ci-review.ts`.

## Session cost and context window

A Linear issue maps to one long-lived eve session that is never explicitly
closed, so its transcript grows across every wake and tool round-trip. A
2026-07-27 production analysis found this dominated spend: long sessions
re-read a near-1M-token transcript on each of a turn's ~14 tool round-trips
(~14M input tokens/turn), and multi-hour idle gaps blew the prompt cache so
afternoon PR/merge hooks paid to rebuild it. Two knobs bound that cost:

- **Earlier compaction** - `agent.ts` sets `modelContextWindowTokens`, which is
  a compaction *trigger*, not a hard cap: eve compacts at
  `floor(modelContextWindowTokens * 0.9)` (see eve `createCompactionConfig` in
  `execution/session.js`), summarizing the older transcript and keeping the
  recent tail verbatim. Session *parking* is the separate `maxInputTokensPerSession`
  knob (default 40M), left untouched. Lowering the trigger caps the per-turn
  re-read; tune down if quality holds, up if summaries drop needed detail.
- **In-context tool-result truncation** - `lib/truncate-for-context.ts` and the
  wrapped `bash`/`web_fetch` tools keep head+tail with an elision pointer so
  high-volume output stops riding every subsequent round-trip. This is distinct
  from `lib/truncate.ts`, which is display-only for Linear activity chips.

## Sandbox and credentials

Each root session receives a persistent Vercel Sandbox with the repository,
locked dependencies, Git, GitHub CLI, terminal tooling, and Playwright.
`ORIENTATION.md` summarizes branch state, unpushed commits, linked worktrees,
GitHub authentication, and screenshot availability.

GitHub credentials are injected by sandbox network policy and never enter the
process environment or repository. Startup tolerates temporary token-mint
failure, retries in the background, and recovers stranded commits when access
returns.

The playtester has its own read-only, screenshot-enabled sandbox. The scoper has
its own read-only sandbox so it can inspect code to size work but cannot write or
push. Declared subagents do not inherit root slots, so each sandbox is authored
under its own directory.

## Connections

| Connection | Purpose | Credential |
| --- | --- | --- |
| Linear MCP | Issues, projects, milestones, documents, and status updates | Vercel Connect app principal |
| Vercel MCP | Deployments, logs, errors, and analytics | Vercel Connect |
| Vercel OpenAPI | Traces, observability queries, and read-only sandbox inspection | `VERCEL_TOKEN` |
| Turso (libSQL) | Hosted database backing Eve's runtime memory store | Vercel Connect app principal (`turso/ts-rogue-eve-memory`) |

The OpenAPI connection derives default team and project identifiers from
`VERCEL_OIDC_TOKEN`; `VERCEL_TEAM_ID` and `VERCEL_PROJECT_ID` may override
them. Resuming a named sandbox is denied because it mutates external state.

Turso is not an MCP or OpenAPI surface, so it has no file under `connections/`.
`lib/memory/connector.ts` mints its Connect credential the same way `VERCEL_TOKEN` is
read for the OpenAPI connection above, and `lib/memory/store.ts` uses it to
run the `memories` table's schema migration and CRUD through `@libsql/client`.
The credential never reaches the sandbox, unlike GitHub's, because the memory
store runs as ordinary application code rather than shell commands the agent
runs inside its own sandbox.

`tools/remember.ts`, `tools/recall.ts`, and `tools/forget.ts` give the model
autonomous read/write access to that store for low-stakes operational facts;
`instructions/memory.ts` loads up to 50 recent memories on every `turn.started`
and feeds them back as JSON-encoded, explicitly untrusted stored data, per
eve's `patterns/multi-tenant-memory.md`. `instructions.md` tells the model what
belongs there instead of `.botfile/memory/domain/product.md`.

`lib/memory/tools.ts` enforces the store's bounds and provenance rules
(HAR-75) as input validation, not just prose: `key` is a restricted-charset,
80-character slug, `value` is capped at 4000 characters, `category` must be
one of a closed allow-list (`workaround`, `debugging-note`, `entity`), and
`source` is required on every write. A `remember` call whose key, value, or
source looks credential- or PII-shaped (API keys, PEM blocks, AWS/GitHub/Slack
tokens, JWTs, SSNs, labeled `password:`/`secret:` values) is rejected outright
rather than merely discouraged. `lib/memory/store.ts` bounds total store size
by evicting the least-recently-updated memory on every write once the store
holds more than 500 rows, so the table cannot grow unbounded.

See [WORKAROUNDS.md](WORKAROUNDS.md) for framework gaps that must be checked
when Eve changes.

## Skills

- `eve` routes Eve framework work to the documentation bundled with the pinned
  package.
- `linear-project-manager` creates or reshapes Linear projects after a human
  approves a broad external write.
- `linear-project-update` drafts or posts grounded project status updates.

Skills supply optional procedures only. Their tools remain controlled by the
connection allow-lists and approval policies.

## Development

| Task | Command |
| --- | --- |
| Run the local agent | `pnpm eve:dev` |
| Run unit tests | `pnpm test:unit` |
| Run all checks | `pnpm check` |
| Inspect discovered Eve surfaces | `pnpm exec eve info` |
| Run all Eve evals | `pnpm exec eve eval` |
| Run the Linear issue-group eval | `pnpm exec eve eval ralph --url https://<deployment>` |

The deployed issue-group eval needs `EVE_EVAL_AUTH_TOKEN`. CI targets the
production alias and uses GitHub OIDC plus
`VERCEL_AUTOMATION_BYPASS_SECRET`.

Repository-wide development requirements live in
[CONTRIBUTING.md](../CONTRIBUTING.md). Current framework-gap maintenance lives
in [WORKAROUNDS.md](WORKAROUNDS.md); historical incidents remain in Git and
Linear.
