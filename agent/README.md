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
| [`sandbox.ts`](sandbox.ts) | Vercel Sandbox bootstrap, sync, network policy, and token refresh |

Linear owns issue status, priority, and progress. GitHub pull requests remain the
review and merge boundary. GitHub credentials are injected through the sandbox
network policy rather than exposed to the agent environment.

The root agent performs bounded orientation, delegates ordinary implementation
to one coding child, and retains review and external coordination. Agent Session
activities carry progress and approval prompts without writing issue comments.

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
RALPH_EVAL_GROUP="ROG-200 ROG-202 ROG-203" eve eval ralph --url https://<deployment>
```

CI runs this weekly and on demand via
[`.github/workflows/ralph-eval.yml`](../.github/workflows/ralph-eval.yml). It
stays off until you set the repo variable `EVE_DEPLOYMENT_URL`; then add the
secrets the workflow references - `RALPH_EVAL_GROUP` (the
`"<parent> <ready> <blocked>"` fixture) and the target auth
(`EVE_EVAL_AUTH_TOKEN`, plus `VERCEL_AUTOMATION_BYPASS_SECRET` if the deployment
has protection).

Repository workflow and requirements live in the [root README](../README.md).
