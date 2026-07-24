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

`ORIENTATION.md` also reports whether the sandbox's Playwright chromium
(`scripts/play-web.mjs`'s screenshots) is confirmed working - `bootstrap`'s
`buildBootstrapCommand` verifies the browser actually launches, not just that
the install step ran, and records the verdict to a status file `onSession`
folds into the brief. `instructions.md`'s contract requires a screenshot in
any PR that changes rendered UI/visual output; this line is how the agent
knows the tooling's state without discovering it by trial and error.

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
