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
| [`hooks/`](hooks/) | Delegated-child activity relay |
| [`tools/`](tools/) | Native Linear Agent Session progress updates |
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

`instructions.md` requires the root to send a `session_update` before its first
other tool call and to batch independent read-only lookups (sub-issue checks,
`ORIENTATION.md`, and similar) into a single turn. `session_update` is the only
durable, top-level Linear activity - tool calls and reasoning relay as
transient `action`/`thought` chips (see `tools/session_update.ts` and
`hooks/child-relay.ts`) - so without an early message a long orientation or
delegation shows only a wall of chips with nothing a human can react to.

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
instructions), not just pi.

This is already the same class of infrastructure `pnpm pr:sandbox`
(`scripts/pr-sandbox.sh`) uses for human PR review - both are Vercel
Sandboxes - but they are two separate sandboxes for two separate jobs: this
file's `defineSandbox` backs the automated agent session (root + its
delegated `agent`-tool child, sharing one sandbox per session), while
`pr:sandbox` provisions its own on-demand sandbox for a human to manually
exercise a PR branch. The `agent` tool - not a `pi` subprocess - remains the
coding-delegation path; it already inherits this sandbox's toolchain and
`instructions.md`'s ponytail rules with no further wiring.

When the assigned issue has sub-issues, the agent treats it as a group (ralph
mode): it sequences the sub-issues by their Linear `blocks`/`blocked by`
relations, priority, and `PROJECT_PLAN.md` phase, then drives one at a time,
advancing to the next only after the current sub-issue's pull request merges to
main. Linear is the only cross-session store - order and readiness are recomputed
from it each turn - and the merge that advances the group is the existing
`isMainMerge` signal in [`channels/github.ts`](channels/github.ts), which tags
the merged issue's identifier so the woken session knows which group to advance.
The sequencing and loop contract lives in [`instructions.md`](instructions.md).

## Development

Run the local agent with:

```bash
pnpm eve:dev
```

Agent integrations and sandbox behavior are covered by the root-level Vitest
suite. Run `pnpm test:unit` or the complete `pnpm check` before handoff.

Ralph mode has an end-to-end eval in [`evals/ralph`](../evals/ralph) that drives
the real agent against a dedicated Linear group and asserts it sequences and
drives the ready sub-issue first. It skips unless the fixture is set; run it
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
