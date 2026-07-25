# Eve project agent

The Eve agent receives ts-rogue work through Linear and runs repository tasks in
pre-warmed Vercel Sandboxes.

## Components

| Path | Responsibility |
| --- | --- |
| [`agent.ts`](agent.ts) | Root and delegated coding model selection |
| [`instructions.md`](instructions.md) | Runtime operating and delegation contract |
| [`channels/`](channels/) | Eve, Linear, and GitHub session activity adapters |
| [`connections/`](connections/) | Linear MCP connection and approval policy |
| [`hooks/`](hooks/) | Delegated-child activity relay (including the ephemeral working indicator) and turn-start sandbox prewarm |
| [`tools/`](tools/) | Native Linear Agent Session progress updates and proactive self-handoff to a fresh session |
| [`sandbox.ts`](sandbox.ts) | Vercel Sandbox bootstrap, sync, `ORIENTATION.md` brief, network policy, and token refresh |
| [`lib/orientation.ts`](lib/orientation.ts) | Builds the pre-computed orientation brief from git state and screenshot-tooling status |

Linear owns issue status, priority, and progress. GitHub pull requests remain the
review and merge boundary. GitHub credentials are injected through the sandbox
network policy rather than exposed to the agent environment.

Orientation is pre-computed rather than rediscovered: the standing contract lives
in `instructions.md`, the Linear session supplies the issue packet, and `onSession`
writes an `ORIENTATION.md` brief of settled git state. The root then delegates
ordinary implementation to one coding child and retains review and external
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
durable `session_update`s. Those child updates are also role-coerced in code
(`tools/session_update.ts`): a child's `started`/`review`/`completed` becomes
`progress` with a `[<issue>]` prefix, because ENG-2's thread showed a child
"Completed" while nothing was pushed, then "Started" again - the session
appeared to finish and restart. No local eval can cover the delegation path
(it needs a live sandbox child, and the ralph e2e fixture deliberately runs
with a blank `agent_session_id`), so coverage is unit tests plus contract text.

`instructions.md` requires the root to send a `session_update` before its first
other tool call and to batch independent read-only lookups (sub-issue checks,
`ORIENTATION.md`, and similar) into a single turn. `session_update` is the only
durable, top-level Linear activity - tool calls and reasoning relay as
transient `action`/`thought` chips (see `tools/session_update.ts` and
`hooks/child-relay.ts`) - so without an early message a long orientation or
delegation shows only a wall of chips with nothing a human can react to. That
early message and the one-sentence reply the root pairs with each tool batch are
both surfaced to the reader: `channels/linear.ts`'s `message.completed` handler
lifts the first line of a tool-batch turn straight into a Linear `thought`, and
`session_update` posts as a durable `response`.

The mid-session update triggers are mechanical rather than judgment-based
("post when it stretches long" let the ROG-65 session run its coding child for
minutes behind a lone `started` message): the batch that starts implementation
must carry a `progress` update with the scoped cut, and three tool-call
batches without a `session_update` force one in the next batch. No eval guards
this yet - the local evals stop before delegation and the ralph e2e fixture
deliberately runs with a blank `agent_session_id`, so it would take a live
Linear session to observe.

Because those sentences reach the reader verbatim, `instructions.md` keeps its
message rules as terse imperatives and holds the design rationale (the
durable-vs-transient mechanics above, the "an early message anchors the session"
framing) here in the README rather than in the runtime prompt. A model told to
write a sentence per batch will parrot whatever meta-language sits next to that
rule; the concrete "reading `ORIENTATION.md`, checking for sub-issues, and
grepping for a symbol are three independent lookups" example that once lived in
the prompt is exactly the kind of procedure text that leaked into user-facing
updates ("Plan: check for sub-issues, read ORIENTATION.md..."). The governing
principle now in `instructions.md`'s Discipline section is that **Eve's messages
describe the work and its status, never the contract's own mechanics** -
orientation lookups, sub-issue checks, delegation, batching, and `pnpm check`
are invisible plumbing, not message content. `evals/message-substance.eval.ts`
is the regression guard: it asserts the `started` message carries substance and
does not echo those process terms.

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
`eve/channels/linear`'s barrel omits `verifyLinearRequest` and
`createDefaultEvents` (confirmed against the module's own runtime exports,
not just its `.d.ts` files). `channels/linear.ts` reimplements both from the
de-minified built-in source, built only from genuinely public primitives
(`signLinearWebhookBody`, `node:crypto`, `createLinearAgentActivity`,
`renderLinearInputRequests`) - see the file's own comments for the exact
provenance of each piece.

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

This is already the same class of infrastructure `pnpm pr:sandbox`
(`scripts/pr-sandbox.sh`) uses for human PR review - both are Vercel
Sandboxes - but they are two separate sandboxes for two separate jobs: this
file's `defineSandbox` backs the automated agent session (root + its
delegated `agent`-tool child, sharing one sandbox per session), while
`pr:sandbox` provisions its own on-demand sandbox for a human to manually
exercise a PR branch. The `agent` tool - not a `pi` subprocess - remains the
coding-delegation path; it already inherits this sandbox's toolchain and
`instructions.md`'s ponytail rules with no further wiring.

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
`channels/linear.ts` already renders the elicitation and resolves the human's
reply (`resolvePromptResponses`). Only after approval does the agent create the
sub-issues over the Linear MCP (`save_issue` with `parentId` and `blockedBy`
relations), which turns the ticket into an ordinary issue group.

When the assigned issue has sub-issues - pre-existing or just created from an
approved breakdown - the agent treats it as a group (ralph mode): it sequences
them by their Linear `blocks`/`blocked by` relations, priority, and
`PROJECT_PLAN.md` phase, then hands off every ready sub-issue at once (capped
at three in flight) instead of driving any of them itself (HAR-15). A
hand-off is one `save_issue` call setting the sub-issue's `delegate` to
`ts-rogue-eve` - the same Linear mechanism that starts an Agent Session for
any human-assigned issue - so each ready sub-issue gets its own independent
session, its own sandbox, its own branch, its own coding child, and its own
pull request, driven end to end under this same `instructions.md` contract
exactly as an ordinary single-issue task. The session that fanned work out
does no git and runs no coding child for a sub-issue itself; it only lists,
orders, and hands off, then stops.

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
sibling the same way. The sequencing and hand-off contract lives in
[`instructions.md`](instructions.md); the local `evals/scoping.eval.ts` guards
the sizing gate (a large synthetic ticket must park with a breakdown and zero
implementation), and `evals/ralph` still guards group sequencing end to end -
its `drivesIssue` assertion already treats a `save_issue` call naming the
ready sub-issue as driving it, so the hand-off eval needed no change for
HAR-15.

### Self-handoff on long sessions (HAR-12)

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