# Eve project agent

Eve takes ts-rogue work from Linear issues to reviewed GitHub pull requests in
pre-warmed Vercel Sandboxes.

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
Automatic ponytail pull-request review runs in GitHub Actions through
`scripts/ci-review.ts`.

Parent issues with independently shippable sub-issues use the `handoff` tool.
Each ready sub-issue receives its own Linear Agent Session and predecessor
context. Blocking relations in Linear determine readiness.

## Components

| Path | Responsibility |
| --- | --- |
| `agent.ts` | Root model configuration |
| `instructions.md` | Stable identity, safety boundaries, and delivery contract |
| `channels/` | Eve, Linear, and GitHub message adapters |
| `connections/` | Allow-listed Linear and read-only Vercel capabilities |
| `hooks/prewarm-sandbox.ts` | Starts sandbox creation and refreshes brokered GitHub auth |
| `sandbox/` and `lib/sandbox.ts` | Vercel Sandbox bootstrap, network policy, token refresh, and recovery |
| `lib/orientation.ts` | Builds the session's concise `ORIENTATION.md` brief |
| `skills/` | Optional Eve and Linear project procedures |
| `subagents/playtester/` | Independent terminal and web acceptance verification |
| `tools/handoff.ts` | Starts an informed successor Agent Session |
| `tools/session_update.ts` | Posts blocked, review, and completion activities |
| `schedules/eve-version-check.ts` | Checks for Eve upgrades and audits framework workarounds |

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

## Sandbox and credentials

Each root session receives a persistent Vercel Sandbox with the repository,
locked dependencies, Git, GitHub CLI, terminal tooling, and Playwright.
`ORIENTATION.md` summarizes branch state, unpushed commits, linked worktrees,
GitHub authentication, and screenshot availability.

GitHub credentials are injected by sandbox network policy and never enter the
process environment or repository. Startup tolerates temporary token-mint
failure, retries in the background, and recovers stranded commits when access
returns.

The playtester has its own read-only, screenshot-enabled sandbox. Declared
subagents do not inherit root slots, so its sandbox and prewarm hook are authored
under its own directory.

## Connections

| Connection | Purpose | Credential |
| --- | --- | --- |
| Linear MCP | Issues, projects, milestones, documents, and status updates | Vercel Connect app principal |
| Vercel MCP | Deployments, logs, errors, and analytics | Vercel Connect |
| Vercel OpenAPI | Traces, observability queries, and read-only sandbox inspection | `VERCEL_TOKEN` |

The OpenAPI connection derives default team and project identifiers from
`VERCEL_OIDC_TOKEN`; `VERCEL_TEAM_ID` and `VERCEL_PROJECT_ID` may override
them. Resuming a named sandbox is denied because it mutates external state.

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
