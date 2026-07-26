# Eve project agent

The Eve agent receives ts-rogue work through Linear and runs repository tasks in
pre-warmed Vercel Sandboxes.

## Components

| Path | Responsibility |
| --- | --- |
| [`agent.ts`](agent.ts) | Root and delegated coding model selection |
| [`instructions.md`](instructions.md) | Runtime operating and delegation contract |
| [`channels/`](channels/) | Eve, Linear, and GitHub session activity adapters |
| [`connections/`](connections/) | Linear MCP connection (allow-listed), Vercel MCP connection (deployments/logs/errors/analytics), and Vercel REST OpenAPI connection (traces, observability queries, read-only sandbox introspection) |
| [`hooks/`](hooks/) | Delegated-child activity relay (including the ephemeral working indicator) and turn-start sandbox prewarm |
| [`schedules/`](schedules/) | Daily eve-version-check: bump, evaluate the changelog against the workaround audit, PR |
| [`tools/`](tools/) | Linear Agent Session handoff updates (blocked/review/completed) and proactive self-handoff to a fresh session |
| [`sandbox.ts`](sandbox.ts) | Root's Vercel Sandbox: bootstrap, sync, `ORIENTATION.md` brief, network policy, and token refresh |
| [`lib/orientation.ts`](lib/orientation.ts) | Builds the pre-computed orientation brief from git state and screenshot-tooling status |
| [`lib/sandbox.ts`](lib/sandbox.ts) | Shared sandbox-provisioning recipe (repo checkout, toolchain, GitHub auth levels, screenshot toggle) composed by the root and future subagents |
| [`subagents/playtester/`](subagents/playtester/) | Declared specialist: checks out a branch, plays the game (`scripts/play.sh` / `scripts/play-web.mjs`) to verify acceptance criteria, returns evidence |
| [`subagents/scout/`](subagents/scout/) | Read-only codebase-recon subagent: locates files, call paths, and utilities, and returns compressed context for a delegation packet |
| [`subagents/reviewer/`](subagents/reviewer/) | Declared specialist: ponytail-reviews one pull request and posts the GitHub review itself |
| [`subagents/coder/`](subagents/coder/) | Declared specialist: implements one scoped issue packet on a named branch, runs `pnpm check`, commits, and pushes the branch itself |

Linear owns issue status, priority, and progress. GitHub pull requests remain the
review and merge boundary. GitHub credentials are injected through the sandbox
network policy rather than exposed to the agent environment. Issue workflow
state is reconciled deterministically by the harness, not by model judgment -
see "Issue lifecycle owned by the harness" below.

### Vercel debugging connections (HAR-20)

Vercel introspection is served by two connections in `connections/`, discovered
by the model through the built-in `connection_search` tool. `connections/vercel.ts`
is the official Vercel MCP server (`mcp.vercel.com`, Vercel Connect OAuth):
deployments, build logs, bounded runtime logs, runtime errors, and web analytics,
allow-listed to read-only tools. `connections/vercel-api.ts` is an OpenAPI
connection over `https://openapi.vercel.sh` for what the MCP server does not
expose: an OTEL trace by request id (`getProjectTrace`), the observability query
engine that also powers the dashboard's Agent Runs / Workflow run views
(including the `$eve.*` workflow-run tags eve writes on every
session/turn/subagent run, see `node_modules/eve/docs/guides/instrumentation.md`),
and listing/inspecting Sandboxes, their sessions, and the commands run inside a
session to triage a stuck or failed sandbox. Its `operations.allow` admits only
read operations, and an exported approval policy (`vercelApiApproval`, tested in
`src/vercel-api-connection.test.ts`) denies `getNamedSandbox` calls carrying
`resume: true`, which would mutate (new instance from snapshot).

These connections replaced the hand-rolled `tools/vercel_*.ts` + `lib/vercel-api.ts`
layer. Two accepted losses, and their re-add path: sandbox command logs
(`getSessionCommandLogs`) and raw `getRuntimeLogs` are excluded because they are
unbounded NDJSON streams a generated tool would hang on (runtime logs are covered
by the MCP connection's `get_runtime_logs`; if command logs are missed, re-add a
single authored tool with a bounded NDJSON reader), and `teamId`/`projectId` are
no longer injected into requests - generated tools take them as model-supplied
inputs, guided by ids embedded in the connection description. Those ids need no
env vars: they are decoded from the deployment's always-present
`VERCEL_OIDC_TOKEN` claims (`owner_id`/`project_id`), with
`VERCEL_TEAM_ID`/`VERCEL_PROJECT_ID` kept only as optional overrides.

The OpenAPI connection needs `VERCEL_TOKEN` (a Vercel API token with read access
to this project) set as a plain environment variable in the Vercel project's
settings. The deployment's OIDC token cannot substitute: tested 2026-07-25,
`api.vercel.com` accepts an OIDC bearer on the `/v2/sandboxes*` endpoints but
returns 403 `invalidToken` on `/v2/observability/*` and `/v1/projects/traces` -
and a warm Fluid instance would serve a stale (~1h) OIDC env token anyway (the
ROG-65 failure class). There is no way to mint an API token from inside a
sandbox, so a human has to add it before it works in production (as of
2026-07-25 the project has no production env vars at all, so the retired
hand-rolled tools were never live in production either). The MCP connection instead
needs its Vercel Connect connector provisioned once from the linked project:
`vercel connect create mcp.vercel.com --name ts-rogue-vercel-mcp` then
`vercel connect attach <connector-uid> --yes`; the first call in a session parks
on an OAuth consent URL rendered natively in Linear.

Orientation is pre-computed rather than rediscovered: the standing contract lives
in `instructions.md`, the Linear session supplies the issue packet, and `onSession`
writes an `ORIENTATION.md` brief of settled git state. The root then delegates
substantive implementation to the declared `coder` subagent and retains review and external
coordination. Agent Session activities carry progress and approval prompts
without writing issue comments.

The sandbox itself is created lazily by eve, on the first sandbox-touching
tool call - which would land mid-orientation and make the model (and the
coding child delegated after it, which shares the root's sandbox) sit
through the full cold start serially. `hooks/prewarm-sandbox.ts` kicks the
same memoized creation at `turn.started`, fire-and-forget, so template
restore and `onSession`'s repo sync run concurrently with the model's first
inference and the first `ORIENTATION.md` read awaits an already-in-flight
handle. The kick must never be awaited in the hook: handlers run in the
turn's emit path, so awaiting there would serialize the cold start in front
of the model call instead of overlapping it.

While a delegated child works, the session shows a single live status slot
rather than a growing wall of chips: `hooks/child-relay.ts` posts an
ephemeral "working" thought the moment a child session starts (the channel
adapter's event vocabulary has no `subagent.called`, so this lives in a hook),
and relays the child's action/reasoning chips with `ephemeral: true` - Linear
displays an ephemeral activity only until the next activity replaces it. What
persists is deliberate: the child's final narration (the handoff record) and
durable `session_update`s. Those child updates are also role-guarded in code
(`tools/session_update.ts`): only `blocked` passes from a child, prefixed
`[<issue>]`; `review` and `completed` return a structured refusal without
posting, because ENG-2's thread showed a child "Completed" while nothing was
pushed, then "Started" again - the session appeared to finish and restart.
The delegation-path wiring is covered by
`evals/delegation/child-session-update.eval.ts`: eve's `mockModel` scripts
the root to delegate and the child to attempt `completed` then `blocked`, so
a real child session runs the real hook and tool code and the eval reads a
single `**Blocked**` activity (and no `**Completed**`) off a local mock
Linear server. It proves wiring, not model policy - a scripted root always
delegates - so the guard's unit tests and the contract text still carry the
policy half.

The session's progress surface is its Agent Plan (HAR-40): `instructions.md`
requires the root's first batch to seed the durable `todo` list with the
issue's outcome-oriented step list, and to flip steps
`in_progress`/`completed` in the same batches that do the work.
`syncAgentPlanFromTodoTool` (see "Agent Plan sync on Linear" below) mirrors
every todo write into Linear's native Agent Plan, so the reader watches a
live checklist instead of a feed of durable chat updates. `session_update`
is reserved for the three human-handoff moments - `blocked`, `review`,
`completed` - because it posts a durable `response`, and Linear derives
session state from the last activity: a `response` means "work completed",
which is exactly why the retired `started`/`progress` statuses kept flipping
sessions to Finished while a delegated child was still running (HAR-38's
ephemeral-chip workaround was superseded by removing the statuses
themselves). The one-sentence reply the root pairs with each tool batch is
still surfaced: `channels/linear.ts`'s `message.completed` handler lifts the
first line of a tool-batch turn straight into a Linear `thought`.

Because those sentences reach the reader verbatim, `instructions.md` keeps its
message rules as terse imperatives and holds the design rationale (the
durable-vs-transient mechanics above, the plan-as-anchor framing) here in the
README rather than in the runtime prompt. A model told to
write a sentence per batch will parrot whatever meta-language sits next to that
rule; the concrete "reading `ORIENTATION.md`, checking for sub-issues, and
grepping for a symbol are three independent lookups" example that once lived in
the prompt is exactly the kind of procedure text that leaked into user-facing
updates ("Plan: check for sub-issues, read ORIENTATION.md..."). The governing
principle now in `instructions.md`'s Discipline section is that **Eve's messages
describe the work and its status, never the contract's own mechanics** -
orientation lookups, sub-issue checks, delegation, batching, and `pnpm check`
are invisible plumbing, not message content. `evals/message-substance.eval.ts`
is the regression guard: it asserts the opening batch seeds a substantive
Agent Plan (steps about the work, not the procedure) and that any
session_update posted does not echo those process terms.

`onSession` can re-run mid-session (a new inbound Linear activity re-attaches
the same sandbox); `SYNC_MAIN_COMMAND` only force-resyncs local `main` to
`origin/main` when HEAD is already on `main`, so a reconnect can't silently
discard an agent's in-progress feature branch or its not-yet-pushed commits.

GitHub push access depends on a background-refreshed token (HAR-5): startup
retries the mint a couple of times before falling back to an open,
unauthenticated policy, and a refresh loop re-mints every 30s while degraded
(45min once healthy), tolerating `MAX_SET_POLICY_FAILURES` consecutive
failures before giving up. `ORIENTATION.md` reports whether auth was
confirmed at session start, and once it is, `onSession` also auto-pushes any
commits a prior session left stranded on the current branch
(`AUTO_RECOVER_PUSH_COMMAND`) before the agent even starts. If push keeps
failing anyway, `scripts/backup-unpushed-work.sh <issue-id>` patches up the
unpushed commits so they survive even if this sandbox is discarded;
`instructions.md` has the agent attach that patch to the Linear issue as a
last resort before reporting the blocker.

### Mid-turn steering on Linear

[`channels/linear.ts`](channels/linear.ts) hand-rolls eve's built-in
`linearChannel()` via `defineChannel` instead of re-exporting it, so it can
reach the route-level `cancel()` primitive the convenience wrapper doesn't
expose. On every inbound Linear Agent Session webhook (`created` and
`prompted` alike) it now calls `cancel({ continuationToken })` unconditionally
right before dispatching the new message, instead of letting the built-in
behavior fold a new comment into the next turn. `cancel()` is a documented
no-op (`"no_active_turn"`) when nothing is running, so this is safe to call on
every message and needs no classification of "correction vs. unrelated" - a
mid-turn Linear comment now really interrupts (`turn.cancelled` ->
`session.waiting`) instead of silently queuing behind the current turn.

Limits, by design:

- It cancels unconditionally on every new inbound message. Two quick
  follow-up comments will cancel each other's turns in sequence rather than
  the agent inferring which one is a correction and which is unrelated.
- Cancelling a turn recursively cancels any active subagent children too (see
  `node_modules/eve/docs/subagents.mdx`, "Cancelling a parent also requests
  cancellation of every active child it started, recursively"). This is also
  how a mid-flight delegated coding subagent gets interrupted - no separate
  subagent-interruption mechanism was built, it's inherent to turn
  cancellation.
- Cancellation stops work at the current step boundary; it does not undo
  already-applied side effects (e.g. git commands the coding child already
  ran). A cancelled mid-git-operation state is a general risk of any
  interruption (crash, redeploy, cancel), not something specific to this
  feature, so no new git-recovery mechanism was added for it.
- A cancel that lands while the root is awaiting a delegated child also drops
  the child's returned result from durable history - eve never synthesizes
  tool results for a cancelled turn. The ENG-2 incident (HAR-11) chained this
  with a false "the child produced nothing" verification into re-delegating
  finished work three times. The recovery is contractual, not mechanical:
  `instructions.md` now requires git-first grounding (`git status` +
  `git log --oneline main..HEAD`) after every child return and at the start
  of every resumed turn, because a child's commits are local until the root
  pushes and the branch - not the conversation - is the record of what is
  done. Instant steering was deliberately kept over fold-in delivery.

The built-in `linearChannel()` doesn't export everything it's built from:
`eve/channels/linear`'s barrel omits `verifyLinearRequest`,
`createDefaultEvents`, and the inbound image attachment pair
`attachLinearInboundImages`/`resolveLinearAccessToken` (confirmed against the
module's own runtime exports, not just its `.d.ts` files).
`channels/linear.ts` reimplements all of them from the de-minified built-in
source, built only from genuinely public primitives (`signLinearWebhookBody`,
`node:crypto`, `createLinearAgentActivity`, `renderLinearInputRequests`, and
global `fetch`) - see the file's own comments for the exact provenance of
each piece. The image port keeps the built-in's 0.27.3 behavior: authenticated
`uploads.linear.app` screenshots in an inbound prompt reach the model as
multimodal file parts, and any untrusted, failed, or non-image reference
falls back to its original markdown text.

### Agent Plan sync on Linear

`channels/linear.ts` also mirrors the durable `todo` framework tool (already
enabled by default) into Linear's Agent Plan preview
(https://linear.app/developers/agent-interaction#agent-plans): its
`"action.result"` event handler (`syncAgentPlanFromTodoTool`) watches for a
completed, non-error `todo` tool call and pushes the current list into
`AgentSession.plan` via `channel.linear.updateSession({ plan })`
(`planFromTodoToolOutput` does the mapping - todo's `in_progress`/`cancelled`
statuses become Linear's `inProgress`/`canceled`). Since HAR-40 this is the
session's primary progress surface, not an additive extra: the contract
mandates seeding the todo list in the first batch and moving it with the
work, and `session_update` is reserved for the blocked/review/completed
handoff moments beside it. An empty todo list is left
alone rather than clearing an existing Linear plan, since the tool's own
"omit `todos` to read" contract means an empty read should not blank out a
plan the agent is still working from.

#### Workaround audit (re-audited against eve 0.27.6, 2026-07-25)

Every hand-rolled piece in this harness exists because eve's public surface
misses a primitive its own internals use. This table is the checklist the
`schedules/eve-version-check.ts` prompt evaluates new changelog entries
against; each future audit updates the date and verdicts.

| Workaround | Lives in | Gap it works around | Verdict at 0.27.6 |
| --- | --- | --- | --- |
| Cancel-and-steer on inbound Linear prompts | `channels/linear.ts` | Built-in dispatch has no `cancel()`; new prompts coalesce into the next turn | Still missing - the built-in route handler destructures only `{send, waitUntil}`; the 0.27.2/0.27.5 cancel/reset additions are Slack-only |
| Webhook verification + default event handlers | `channels/linear.ts` | `verifyLinearRequest`/`createDefaultEvents` unexported from the barrel | Still unexported |
| Inbound image attachment | `channels/linear.ts` | `attachLinearInboundImages`/`resolveLinearAccessToken` unexported | Still unexported - ported here (built-in gained it in 0.27.3) |
| GitHub @mention gate reimplementation | `channels/github.ts` | `extractGitHubCommentTrigger`/`shouldDispatchGitHubComment` not public; custom `onComment` replaces the built-in gate wholesale | Still not public; `pull_request_review` (top-level verdict) events still unparsed |
| Session handoff instead of quota continuation | `tools/handoff.ts` | Token-quota HITL prompt not overridable; `commentCreate` unexported | Still no public hook (0.27.1 only changed decline behavior) |
| File-based child session-id handoff | `hooks/child-relay.ts` | `subagent.called` declared in the hook vocabulary but never dispatched to authored hooks/channels | Still absent from `ChannelEvents` |
| Eager sandbox prewarm + durable token re-mint | `hooks/prewarm-sandbox.ts` | Lazy sandbox creation; no session-end hook; in-process token timers don't survive harness recycling | Unchanged |
| Sandbox lifetime/timeout re-assertion, token fallback chain | `sandbox.ts` | Create-time options don't apply to resumed sandboxes (ROG-65); connect token cache staleness | Unchanged. eve 0.27.5's `workspace/` seed files were evaluated and rejected: seed paths are workspace-relative only (the files this bootstrap writes live in `~/.config` and `/etc`), and seeding `/workspace` would have broken bootstrap's `git clone` into an empty directory - HAR-34 replaced the clone with an in-place `git init`/`git remote add`/`git fetch`/`git reset --hard` sequence, which no longer requires an empty `/workspace`, but eve's `workspace/**` seed-file layout itself is not yet adopted (separate follow-up HAR-36) |
| Vercel introspection | `connections/vercel.ts` + `connections/vercel-api.ts` | Vercel MCP server lacks sandbox/trace/observability tools; no Vercel-API credential helper in `@vercel/connect/eve` | Retired the hand-rolled `tools/vercel_*.ts` + `lib/vercel-api.ts` layer in favor of an MCP + OpenAPI connection pair. `VERCEL_TOKEN` env still required for observability/traces (OIDC bearers 403 there; sandbox endpoints would accept them). `teamId`/`projectId` now derived from OIDC claims. Accepted loss: sandbox command logs (see "Vercel debugging connections") |
| Agent Session posting in code | `tools/session_update.ts`, `tools/handoff.ts`, `hooks/child-relay.ts`, `channels/linear.ts` | `mcp.linear.app` exposes no Agent Session tools (`agentActivityCreate`, `agentSessionCreateOnComment`), and hooks/channel code cannot call connection tools at all | Not replaceable by the Linear MCP connection until Linear ships agent-session MCP tools |
| Issue workflow-state sync | `lib/issue-state.ts`, `channels/linear.ts`, `channels/github.ts` | Linear Agent Sessions never move issue state; eve has no issue-state primitive, and workflow-state queries/`issueUpdate` are not in the public barrel | New at 0.27.6 - built on the public `callLinearGraphQL` transport |
| Human-to-agent `stop` signal | `channels/linear.ts` | eve parses `agentActivity.signal` off the wire but never inspects Linear's `stop` human-to-agent signal; a stop request reaches the model as ordinary prompt text with no guaranteed halt | New - hand-rolled: cancels the turn and confirms via a response activity without ever dispatching a new turn to the model |

`ORIENTATION.md` also reports whether the sandbox's Playwright chromium
(`scripts/play-web.mjs`'s screenshots) is confirmed working - `bootstrap`'s
`buildBootstrapCommand` verifies the browser actually launches, not just that
the install step ran, and records the verdict to a status file `onSession`
folds into the brief. `instructions.md`'s contract requires a screenshot in
any PR that changes rendered UI/visual output; this line is how the agent
knows the tooling's state without discovering it by trial and error.

`instructions.md` (HAR-6) also requires that screenshot to travel with the
PR's changeset, not just its body: when a UI-visual PR also carries a
`pnpm changeset` file (release-facing behavior), the agent embeds the same
committed `docs/pr-assets/<issue-id>/` screenshot as a Markdown image inside
that changeset. A PR body link is visible to a human reviewer but is not part
of the changeset's content, so it would otherwise be lost the moment
`pnpm version-packages` folds the changeset into `CHANGELOG.md` - embedding it
in the changeset itself is what carries the visual evidence into the
changelog.

`buildBootstrapCommand` also installs the agent-facing CLI toolchain (HAR-3):
`ripgrep`, `fd`, `bat`, `eza`, and `ast-grep` are on `PATH` in every session's
sandbox (the root and its coding child share that sandbox), and `pi install`
adds the [ponytail](https://github.com/DietrichGebert/ponytail) extension for
`scripts/play.sh dev`'s interactive pi sessions. `instructions.md`'s Standing
rules carry ponytail's YAGNI/minimal-diff ladder directly, so it governs the
root's own decisions and the delegated coding child (both run the same
instructions), not just pi. Having the toolchain on `PATH` was not enough by
itself (HAR-7): the root and child kept reaching only for the built-in
`grep`/`glob`/`read_file` tools and skipping it, plus falling into silent or
one-at-a-time tool calls despite the batching rule already existing.
`instructions.md`'s Discipline section now explicitly calls out `ast-grep` for
structural (syntax-aware) searches the built-in tools can't express, pairs
every batch of tool calls with a short immediate reply instead of silence,
and gives the batching rule a concrete example.

### Shared sandbox recipe (HAR-26)

`agent/sandbox/sandbox.ts` no longer defines the provisioning building blocks
itself: they moved to `agent/lib/sandbox.ts` so a subagent
(`agent/subagents/<id>/sandbox.ts`, HAR-27..30) can compose them without
duplicating this file. The root's own
`bootstrap`/`onSession` are still written out by hand here, since only the
root builds the `ORIENTATION.md` brief; they just call the shared
`buildBootstrapCommand`, `resolveStartupNetworkPolicy`, `keepTokenFresh`, and
friends instead of owning that logic inline. `lib/sandbox.ts`'s
`buildSandboxDefinition(options)` is the one-call surface for everyone else:
it takes a `gitAuthLevel` (`"none"` never mints or refreshes a GitHub token,
for a subagent that only reads files already on disk from bootstrap's clone;
`"read-only"` and `"push-capable"` both broker and keep refreshed the same
GitHub App installation token, since the platform has no finer scope split -
a `"read-only"` caller technically holds a token that could push, a ponytail
gap noted in the type's own comment and fixable only once a GitHub connector
supports narrower scopes than `["*"]`; `"push-capable"` additionally runs
main-branch sync and stranded-push auto-recovery, for a branch-pushing
subagent like `coder`) and a `screenshotTooling` flag (installs and verifies
Playwright chromium during bootstrap; off by default since only the root and
`playtester` need it). A read-only scout subagent's whole
`sandbox.ts` is then one line:
`export default defineSandbox(buildSandboxDefinition({ gitAuthLevel: "none" }));`
`playtester` (HAR-29) composes the same helper with
`{ gitAuthLevel: "read-only", screenshotTooling: true }`: it can fetch and
check out a branch to verify but never push, and its bootstrap installs the
same Playwright chromium the root uses for `scripts/play-web.mjs` screenshots.
Its own `instructions.md` tells it to actually play the branch it's given
(`scripts/play.sh` for the terminal renderer, `scripts/play-web.mjs` for the
web renderer), verify the caller's named acceptance criteria against what
renders, and return a verdict per criterion with evidence embedded in its
reply - a terminal frame as a fenced text block, a web screenshot as an
embedded `data:image/png;base64,...` Markdown image - since a declared
subagent's sandbox is its own, not shared with its caller's. `instructions.md`'s
end-to-end-reproduction and mandatory-screenshot rules now delegate to it
instead of having the root or its coding child drive the play scripts inline.

This is already the same class of infrastructure `pnpm pr:sandbox`
(`scripts/pr-sandbox.sh`) uses for human PR review - both are Vercel
Sandboxes - but they are two separate sandboxes for two separate jobs: this
file's `defineSandbox` backs the automated agent session (root + its
delegated `agent`-tool child, sharing one sandbox per session), while
`pr:sandbox` provisions its own on-demand sandbox for a human to manually
exercise a PR branch. The `agent` tool - not a `pi` subprocess - remains the
coding-delegation path; it already inherits this sandbox's toolchain and
`instructions.md`'s ponytail rules with no further wiring.

### Seed-workspace folder layout (HAR-36)

The root sandbox uses eve's folder layout, `agent/sandbox/sandbox.ts` plus
`agent/sandbox/workspace/**`, instead of the `agent/sandbox.ts` shorthand.
`agent/sandbox/workspace/.config/gh/hosts.yml` and
`agent/sandbox/workspace/.gitconfig` are real, reviewable files with the same
content `buildBootstrapCommand`'s `SEED_GH_CLI_AUTH_COMMAND` heredoc and
`git config --global --add safe.directory '*'` line used to write with shell
(HAR-35 relocated `gh`/git config under `/workspace` via `GH_CONFIG_DIR`/
`GIT_CONFIG_GLOBAL`; this just replaces how that content gets there). eve
mirrors `workspace/**` into `/workspace` before bootstrap's command ever
runs, so the root calls `buildBootstrapCommand({ seedGitHubConfig: false })`
to skip the now-redundant shell writes; `buildBootstrapCommand` still seeds
them via shell by default for every subagent composing
`buildSandboxDefinition`, since none of them have a seeded workspace of their
own. Seed content (like authored sandbox source) is tracked automatically by
eve's template revalidation, so editing either seed file rebuilds the
template on the next session. Bootstrap keeps owning everything that touches
the root filesystem or is dynamically generated - the apt HTTPS-mirror
rewrite, `/usr/local/bin` symlinks, package installs, the verified-chromium
check, the repository checkout (HAR-34), and `pnpm install`.

### Scout subagent (HAR-27)

`agent/subagents/scout/` is the first declared subagent under the HAR-27..30
line the shared sandbox recipe was built for. It composes
`buildSandboxDefinition({ gitAuthLevel: "none" })` for its whole `sandbox.ts`
(no GitHub token ever minted; it only reads the repo state bootstrap already
cloned), carries its own `instructions.md` rather than inheriting the root's
(a declared subagent inherits nothing but its own authored slots, per
`node_modules/eve/docs/subagents.mdx`), and has no `tools/`, `connections/`,
or `skills/` of its own - it relies entirely on the built-in bash/read/grep/
glob tools every session already gets. Its role is to run ahead of a
delegation whose scope isn't yet clear, trade its own context budget for
locating relevant files, call paths, reusable utilities, and invariants/
gotchas, and hand back a compressed summary (capped at roughly 200 lines) sized
to drop directly into `coder`'s packet, instead of the root exploring
inline itself. `instructions.md`'s Delegation section now names it as the tool
to reach for in that situation.

### Reviewer subagent (HAR-28)

`agent/subagents/reviewer/` is a declared specialist built on the
HAR-26 sandbox recipe: its own `agent.ts` (`anthropic/claude-sonnet-5`), its
own `instructions.md` carrying the full ponytail review contract (fetch the
diff, apply the over-engineering and conventions/stack-idioms lenses, post
one GitHub pull-request review via `curl` with inline comments anchored to
added or changed diff lines), and a one-line `sandbox.ts` composing
`buildSandboxDefinition({ gitAuthLevel: "read-only" })` - enough GitHub auth
to fetch a diff and POST a review, never push. Declared subagents inherit
nothing from the root, so this instructions.md is a complete copy of the
lens/posting procedure `channels/github.ts`'s `ponytailReviewContext` already
builds per-PR, not a reference to it.

The root's own "PR review turns" section in `instructions.md` no longer does
the review inline: it now delegates the whole job to `reviewer`, passing the
turn's review context (PR number, diff-fetch commands, the two lenses, the
posting endpoint/JSON) as the subagent's `message` and relaying nothing else
back. `channels/github.ts`'s `onPullRequest` is unchanged - it still builds
that context string and dispatches a review-only turn exactly as before;
only what the root *does* with that turn changed. This is what unlocks a
Workflow fan-out reviewing several open pull requests in parallel
(`Promise.all(prs.map((n) => tools.reviewer({ message: ... })))`), which a
bare copy of the root (the built-in `agent` tool) cannot do on its own since
every copy carries the full root contract instead of a lean review-only one.

### Coder subagent (HAR-30)

`agent/subagents/coder/` is the declared specialist that replaces the
built-in `agent` tool as the coding child for substantive implementation. Its
own `agent.ts` keeps the `deepseek/deepseek-v4-flash` model the coding-child
branch of the root's `agent.ts` (`codingWorkerModel`) used before this
subagent existed, its `instructions.md` is a packet-driven implementation
contract only (trust the packet, read only task-relevant files and their
callers, climb the ponytail ladder, respect the architecture invariants, run
`pnpm check`, commit, push - no sizing, no ralph mode, no Linear session
ownership), and its `sandbox.ts` composes
`buildSandboxDefinition({ gitAuthLevel: "push-capable" })` - the first
subagent that needs full push access rather than read-only or no GitHub auth
at all. Its `tools/session_update.ts` re-exports the root's tool (declared
subagents inherit no root tool slots), and the shared role guard makes
`blocked` the only status coder can actually post - `review`/`completed`
are refused in code.

This inverts the old delegation model: a declared subagent's sandbox is not
shared with the root, so `coder` cannot hand back local commits the way the
built-in `agent` tool's same-sandbox child did. Instead `coder` commits and
pushes its own feature branch, and the root fetches and verifies
`git log origin/main..origin/<branch>` against `coder`'s report before
opening the PR - the "child never pushes, commits stay local" rule in
`instructions.md`'s Delegation section now applies only to the built-in
`agent` tool, which stays enabled for quick same-sandbox mechanical work
(a single-file edit, a merge conflict) and never for substantive
implementation. `instructions.md` states that bright line explicitly so no
turn spends time deciding which of the two to reach for.

### Sizing gate and issue groups (ralph mode)

HAR-9 added a sizing gate in front of implementation. ENG-1 showed the failure
mode it prevents: a multi-deliverable ticket delegated whole to one coding
child burned a 38M-token session across several restarts. The gate is a
judgment over the issue packet alone (no new orientation reads, per
`AGENTS.md`): an issue that cannot land as one reviewable PR is broken into a
sub-issue plan of PR-sized workstreams first. The proposed breakdown posts as a
`review` session_update and then parks the turn on eve's built-in
`ask_question` tool - the stop before approval is enforced by the runtime's
`input.requested`/`session.waiting` protocol, not by prompt discipline, and
`channels/linear.ts` already renders the elicitation (with Linear's native
select signal via `linearInputRequestSignal`; since eve 0.27 the runtime, not
the channel, matches the human's reply to the pending input request). HAR-17
tracked a further-back regression: eve's Linear channel used to append a
base64 `<!-- eve-input:... -->` tracking blob straight into that visible
message body, leaking a technical token into every elicitation a human saw
(a `#99` attempt hand-rolled the fix by moving that payload into
`signalMetadata`, but eve's own 0.27 upgrade later fixed this upstream -
`renderLinearInputRequests` now renders clean prompt/option text and reply
matching moved server-side - which is why `#99` closed unmerged);
`src/linear-channel.test.ts`'s `input.requested elicitation (HAR-17)` suite
now locks in that the posted body carries no marker text. Only
after approval does the agent create the
sub-issues over the Linear MCP (`save_issue` with `parentId` and `blockedBy`
relations), which turns the ticket into an ordinary issue group.

When the assigned issue has sub-issues - pre-existing or just created from an
approved breakdown - the agent treats it as a group (ralph mode): it sequences
them by their Linear `blocks`/`blocked by` relations, priority, and
`PROJECT_PLAN.md` phase, then hands off every ready sub-issue at once (capped
at three in flight) instead of driving any of them itself (HAR-15). Readiness
is recomputed from Linear immediately before each hand-off, not trusted from
the plan posted earlier in the turn, so a sub-issue whose blocker hasn't
actually finished never gets a session started for it.

A hand-off reuses `tools/handoff.ts` (see "Self-handoff on long sessions"
below) rather than a bare `save_issue` delegate assignment: it posts a Linear
comment on the sub-issue carrying a brief of what its `blocked by`
predecessor(s) just shipped - their PR, key decisions, anything that changes
this sub-issue's approach - and anchors a fresh Agent Session to that comment
with `createLinearAgentSessionOnComment`. Neither `AgentSessionCreateOnIssue`
nor `AgentSessionCreateOnComment` takes a free-text field of its own (see the
tool's comments), so a comment is the only way to seed a fresh session with
anything beyond its bare issue packet - the same reason `tools/handoff.ts` was
built for self-continuation in the first place, which is why HAR-15 reuses it
here instead of adding a second, near-identical mechanism. The agent also sets
the sub-issue's `delegate` to `ts-rogue-eve` with `save_issue` alongside the
hand-off, so Linear's own assignment reflects who is driving it. Each ready
sub-issue then gets its own independent session, its own sandbox, its own
branch, its own coding child, and its own pull request, driven end to end
under this same `instructions.md` contract exactly as an ordinary single-issue
task. The session that fanned work out does no git and runs no coding child
for a sub-issue itself; it only lists, orders, hands off with context, and
stops.

This replaces an earlier design where the parent kept every sub-issue's branch
in a `.worktrees/<id>` git worktree inside its own single sandbox and drove
each with a batched built-in `agent`-tool child, claiming it first with an
atomic `git push origin main:refs/heads/<branch>` to de-race a concurrently
woken session. That model's appeal was one sandbox, one toolchain bootstrap,
and a single narrative thread; its cost was that the parent alone carried all
of that git bookkeeping (claim races, worktree cleanup, per-worktree unpushed-
commit recovery), and worktree branches were invisible to the current-branch
recovery checks that assume one branch per sandbox. Handing sub-issues to
independently triggered sessions instead gives each one the same real sandbox
isolation every other session already gets, at the cost of the parent's single
narrative thread: advancing the group after a merge is now something whichever
session owns the merged sub-issue does on its own next turn, not something the
original parent session does centrally.

Linear is the only cross-session store - order and readiness are recomputed
from it each turn - and the merge that advances the group is still the
existing `isMainMerge` signal in [`channels/github.ts`](channels/github.ts),
which tags the merged issue's identifier so the session it wakes knows which
group to advance: confirm that sub-issue Done, then hand off every newly ready
sibling the same way, carrying forward what that merge just shipped. The
sequencing and hand-off contract lives in [`instructions.md`](instructions.md);
the local `evals/scoping.eval.ts` guards the sizing gate (a large synthetic
ticket must park with a breakdown and zero implementation), and `evals/ralph`
still guards group sequencing end to end - its `drivesIssue` assertion already
treats a `save_issue` call naming the ready sub-issue as driving it, which
covers the `delegate` update half of a hand-off without needing to distinguish
it from the `handoff` tool call that carries the context.

### Unattended Linear access and GitHub auth surfacing (HAR-33)

The merge-wake turn above runs on the GitHub channel under whatever principal
merged the pull request - and it must read Linear (confirm the sub-issue Done,
recompute readiness) through the Linear MCP connection. When that connection
was user-scoped interactive OAuth (`connect("mcp.linear.app/ts-rogue-eve-mcp")`),
the grant was bound to the inbound principal: a GitHub sender who had never
authorized it parked the turn on `authorization.required`, and because eve's
GitHub defaults (unlike this repo's Linear channel since HAR-31) implement no
`authorization.*` handlers, the park was invisible - no PR comment, no error,
no log. Every ralph merge-advance turn stalled this way; issue groups never
advanced past their first merged sub-issue.

Two changes, both in this repo:

- [`connections/linear.ts`](connections/linear.ts) resolves the Linear MCP
  connection app-scoped:
  `connect({ connector: "linear/ts-rogue-eve", principalType: "app" })` - the
  same Linear agent-app token the channel and authored tools already use
  unattended, in the exact shape eve's auth guide prescribes for acting as the
  agent itself. No consent flow exists for app-scoped auth, so merge wakes,
  schedules, and any other unattended turn reach Linear without a human in the
  loop. (Linear writes are attributed to the agent app rather than the
  delegating user, which is what agent-driven `save_issue` calls should read
  as anyway.)
- [`channels/github.ts`](channels/github.ts) ports HAR-31's
  `authorization.required`/`authorization.completed` handlers so any future
  user-scoped challenge on a GitHub-dispatched turn (the Vercel MCP connection
  is still user-scoped) posts the authorization link as a thread comment
  instead of parking silently. GitHub has no native auth signal like Linear's
  "Link account" elicitation, so a plain comment is the whole affordance.

### Handoff to a fresh session (HAR-12, HAR-15)

HAR-12 asked for eve's own token-quota HITL (a continue/stop prompt raised
when a session crosses its configured `maxInputTokensPerSession`/
`maxOutputTokensPerSession`) to auto-compact and continue instead. That
prompt, the quota check, and the budget-reset logic all live inside the `eve`
package's harness internals (`session-limit-enforcement`/
`session-limit-continuation`); no released version exposes a config, hook, or
channel-event API that lets this repo override or auto-answer it, and
`agent/hooks/*` are deliberately observe-only (see above), so they cannot
resolve a pending input request either.

`tools/handoff.ts` sidesteps the problem instead of solving it upstream: it
gives the root agent a way to voluntarily end its own session before ever
reaching that quota, rather than waiting to be asked. Calling it posts the
model-authored `brief` (a continuation packet - what's done, evidence, what's
left, the next action) as a Linear comment via a hand-rolled `commentCreate`
mutation (not in `eve/channels/linear`'s public barrel, so it's built against
the barrel's public `callLinearGraphQL` transport the same way
`channels/linear.ts` hand-rolls other de-minified pieces), then calls the
barrel-exported `createLinearAgentSessionOnComment` to anchor a brand-new
Agent Session to that comment. The new session gets its own empty context
window and its own fresh token quota; eve's existing webhook delivery to
`channels/linear.ts` picks up its `created` event the same way it would for a
human-initiated session, so no extra dispatch wiring was needed.
`instructions.md` tells the root to reach for this proactively on a session
that has been running unusually long - a deep delegation chain or a slow
implementation - rather than treating quota exhaustion as something that
happens to it.

HAR-15 reuses the same tool and mutation chain for a second purpose: handing a
now-ready sub-issue off to its own fresh session in ralph mode, carrying
forward the context (what its predecessor shipped, and why) that a bare
`save_issue` delegate assignment could not deliver. The tool already took an
arbitrary `issueId`, not "the current issue" specifically, so nothing about
`tools/handoff.ts` itself needed to change beyond broadening its description
and de-specializing the fixed comment header (the "why this session exists"
framing now lives entirely in the model-authored `brief`, which differs by
caller: a continuation packet for self-handoff, a predecessor's shipped
context for a dependency unlock).

### Issue lifecycle owned by the harness

Linear issue workflow state used to drift because every transition depended on
the model choosing to call `save_issue`. Four transitions are now reconciled
in code, all through `lib/issue-state.ts` (`advanceIssueState`, hand-rolled
over the public `callLinearGraphQL` transport like `lib/live-sessions.ts`):

- **Session created → In Progress**, cascading to an unstarted parent so a
  group's parent never sits in Todo while sub-issues are in flight. Runs in
  `channels/linear.ts`'s `dispatchAgentSession` *after* `send()` (state sync
  never delays dispatch; the `waitUntil`-tracked promise keeps it alive) and
  only for `created` events - every `prompted` event follows a created one
  that already synced. A guard-declined duplicate session never reaches it.
- **PR opened / ready for review → In Review**, keyed off
  `linearRefFromPullRequest` in `channels/github.ts`'s
  `onPullRequestWithStateSync` wrapper (eve runs `onPullRequest` under
  `waitUntil` and accepts an async result). Skipped silently when the team
  has no started-type state named like "review". `synchronize` is excluded -
  state was set at open.
- **PR merged to main → Done**, same wrapper. The sync deliberately completes
  before the dispatch decision returns, so the woken ralph-advance turn
  already observes the merged sub-issue Done when it recomputes readiness.
- **Session failed → Blocked** (`session.failed` only - `turn.failed` is
  recoverable), so an unrecoverably dead session never leaves its issue
  falsely In Progress. Skipped silently when the team has no state named
  like "Blocked".

Every transition is forward-only and idempotent: state types rank
triage/backlog/unstarted < started < completed/canceled, and within
started-type states board `position` decides (In Progress before In Review on
Linear defaults - a team ordered otherwise just skips the transition, never
downgrades). Done and Canceled are terminal; only Blocked may move an issue
sideways, and never out of a terminal state. `advanceIssueState` never
throws: a Linear outage degrades to a skipped transition, never a blocked
dispatch, a suppressed review, or a lost ralph wake. The model keeps exactly one
state-transition duty: moving a group parent to Done when all sub-issues are
Done (`instructions.md`, Issue groups) - the harness cascades only In
Progress to parents, never Done.

### One live session per issue (duplicate-delegation guard)

Two live Agent Sessions on one issue means two sandboxes, two branches, and
two coding children racing on the same work - exactly what happened on HAR-26
when a human assigned the agent as the issue's delegate while a
handoff-created session was already running. Linear itself keeps no such
invariant, and eve keys sessions by Agent Session id, not issue, so the guard
is two-sided here, with `lib/live-sessions.ts` (`listLiveAgentSessions`, a
`callLinearGraphQL` query for the issue's non-terminal sessions - `pending`/
`active`/`awaitingInput` count as live; `complete`/`error`/`stale` do not) as
the shared pre-check:

- **At creation** - `tools/handoff.ts` refuses to create the comment or the
  session when the issue already has another live session, returning
  `alreadyLive` with that session's id and URL so the model reports instead
  of duplicating. The caller's own session is excluded (its id rides in the
  dispatch-auth attributes `defaultLinearAuth` stamps, the same side channel
  HAR-24's review-only flag uses), since self-continuation hands off the very
  issue the caller is still live on.
- **At dispatch** - `channels/linear.ts` (`guardedOnAgentSession`, the third
  behavior change vs. the built-in channel) declines a `created` webhook for
  an issue that already has an older live session: it posts one `response`
  activity pointing at the live session (a `response` is how sessions
  conclude in Linear's protocol, so the duplicate lands `complete` instead of
  stuck `pending` - `AgentSessionUpdateInput` has no status field to set
  directly) and returns `null` so no eve session spins up. Agent-created
  sessions (`creatorId === appUserId`) are exempt: the handoff tool already
  gated them, and guarding them here would decline every self-continuation
  successor, whose predecessor is still live when the successor's `created`
  webhook arrives. Oldest `createdAt` wins, so two near-simultaneous
  sessions cannot both decline each other.

Both sides fail open (missing issue id, GraphQL failure): a flaky pre-check
must never block a legitimate delegation or leave a fresh session silently
undispatched. `prompted` events are never guarded - re-prompting an existing
session is an explicit human act. Residual gap: the agent assigning itself as
delegate via a bare `save_issue` bypasses both guards; `instructions.md`
already mandates `handoff` over bare delegate assignment.

### Review-feedback turns (HAR-16)

`channels/github.ts` already dispatches an in-repo ponytail auto-review when a
pull request opens or leaves draft (`onPullRequest`'s `opened`/`ready_for_review`
branch), posting inline comments through GitHub's pull-request-review API.
Those comments, and any a human reviewer leaves the same way, arrive back at
eve as `pull_request_review_comment` webhook events - the only granularity of
"pull request review" eve's public `githubChannel` API parses; the coarser
`pull_request_review` event (a review submitted with only a top-level
verdict/body and no inline comments) isn't parsed by eve at all as of the
version pinned here, so that case cannot wake a turn without a bespoke
verified webhook route - out of scope for this change.

Before HAR-16, `onComment` was unset, so eve's built-in mention gate applied
to every comment kind: review feedback sat unanswered unless a human
remembered to type `@ts-rogue-eve` in the review. `channels/github.ts` now
supplies its own `onComment`, dispatching when `ctx.conversation.kind ===
"review_thread"` (an inline review comment) and it is a new finding, while
reimplementing the mention check (`isBotMentioned`) for every other comment
kind, since providing `onComment` replaces eve's built-in gate entirely
rather than layering on top of it. The reimplementation is scoped to the
mention regex alone - the bot-authored/self-comment loop guard needs no
reimplementation, because eve applies that (`isIgnoredInboundComment`) before
ever calling `onComment`, confirmed by reading `dispatch.js`'s
`dispatchPullRequestReviewComment`. As with `channels/linear.ts`'s earlier
precedent, the reimplemented pieces are not part of eve's public
`./channels/github` export surface (only `defaultGitHubAuth` ships from
`defaults.js`; `inbound.js`'s `extractGitHubCommentTrigger` and
`shouldDispatchGitHubComment` have no public subpath), so this is ported from
the installed package's own de-minified source rather than guessed at.

"New finding" excludes replies within an already-open review thread: GitHub
fires the same `pull_request_review_comment` webhook for every later reply
in a thread, and a reply is conversation about a finding already surfaced,
not a fresh one that needs its own turn. The webhook payload marks a reply
with `in_reply_to_id`; eve's normalized `GitHubComment` drops that field, so
`isNewReviewFinding` reads it off `comment.raw` directly, the same escape
hatch `onPullRequest` already uses for fields the normalized event omits.

The dispatched turn carries a short context string pointing at
`instructions.md`'s new "PR review-feedback turns" section rather than
repeating the procedure inline, the same pattern `ponytailReviewContext`
already uses for "PR review turns". That section tells the agent to check
out the pull request's branch with `gh pr checkout`, ground itself with
`git log`/`git status` before changing anything, fix and push a follow-up
commit when the feedback names a concrete change (or reply in the thread
otherwise), and skip orientation, sizing, delegation, and `session_update` -
this turn has no Linear Agent Session, only the GitHub conversation the
comment arrived on.

## Development

Run the local agent with:

```bash
pnpm eve:dev
```

Agent integrations and sandbox behavior are covered by the root-level Vitest
suite. Run `pnpm test:unit` or the complete `pnpm check` before handoff.

Ralph mode has an end-to-end eval in [`evals/ralph`](../evals/ralph) that drives
the real agent against a dedicated Linear group and asserts it sequences and
hands off the ready sub-issue first. It skips unless the fixture is set; run it
against a sandbox-reachable target:

```bash
EVE_EVAL_AUTH_TOKEN=<bearer> eve eval ralph --url https://<deployment>
```

The fixture is a fixed do-not-delete Linear group (identifiers in
[`evals/ralph/shared.ts`](../evals/ralph/shared.ts)), so it is code, not config.
CI runs this weekly and on demand via
[`.github/workflows/ralph-eval.yml`](../.github/workflows/ralph-eval.yml),
targeting the `bob-v0` production alias. Deployment auth is a short-lived GitHub
OIDC token minted per run and verified by `oidc()` in
[`channels/eve.ts`](channels/eve.ts) - no stored bearer. The only secret is
`VERCEL_AUTOMATION_BYPASS_SECRET` (the Vercel protection bypass), which also
gates the run: the job self-skips until it is set.

Repository workflow and requirements live in the [root README](../README.md).
