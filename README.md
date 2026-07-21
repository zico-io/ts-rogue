# ts-rogue

A TypeScript terminal dungeon crawler. This repository holds the playable-loop specification, the coding harness, and a playable Ink application.

## Requirements

- Node.js 24
- pnpm 11.7.0 (pinned via `packageManager`; run `corepack enable`)
- Git

## Setup

```bash
pnpm install
pnpm check
```

## Repository map

| Path | Purpose |
| --- | --- |
| [`PROJECT_PLAN.md`](PROJECT_PLAN.md) | Product scope, architecture, milestones, and definition of done |
| [`docs/product.md`](docs/product.md) | Shipped product state and documentation upkeep contract |
| [`agent/`](agent/) | Eve project agent, Linear integration, tools, and sandbox configuration |
| [`.botfile/memory/`](.botfile/memory/index.md) | Curated, provenance-backed agent memory |
| [`AGENTS.md`](AGENTS.md) | Coding-agent operating instructions |

## Workflow

Work is tracked in Linear. GitHub pull requests are used for review and merge. Each pull request links its Linear issue and updates product documentation when behavior, commands, or requirements change.

| Task | Command |
| --- | --- |
| Run all repository checks | `pnpm check` |
| Run the game (Ink shell) | `pnpm game` |
| Run the game with the switchable dev console | `pnpm game:dev` |
| Drive the game in a tmux session (play harness) | `pnpm play start` |
| Test a PR's build remotely (interactive shell) | `pnpm pr:sandbox <PR#>` |
| Run the Eve agent locally | `pnpm eve:dev` |
| Type-check | `pnpm typecheck` |
| Run tests | `pnpm test` |
| Lint | `pnpm lint` |
| Format | `pnpm format` |
| Check documentation | `pnpm docs:check` |

## Devtools

`pnpm play start [seed]` drives the real game in a detached `tmux` session so an
agent (or you) can play it like a user; `pnpm play key <tokens>`, `pnpm play
frame`, and `pnpm play stop` send input and capture the coloured screen. Requires
`tmux` (`brew install tmux`); the `.claude/skills/play-game` skill documents the loop.

The dev console (`pnpm game:dev`, backtick) can file a Linear issue live with
`issue <title>` / `bug <title>`, pre-filled with a reproducible session packet
(seed, key sequence, state, log). Credentials are brokered by Vercel Connect -
the same `linear/ts-rogue-eve` connector the Eve agent uses - so no Linear key
is stored; it only needs `VERCEL_OIDC_TOKEN` in `.env.local` (which `game:dev`
loads). Override the team with `LINEAR_TEAM_KEY` (default `ROG`). If that
identity is missing or the call fails, the issue is saved to a local
`dev-issues.jsonl` outbox and retried on the next filing or the console's
`flush` command, so nothing is lost.

`pnpm pr:sandbox <PR#>` spins up (or resumes) a persistent Vercel Sandbox on
that PR's head, installs deps, and drops you into an interactive shell in the
checked-out repo - run `pnpm game` to play the build or `pnpm check` to verify
it, remotely. Re-running after new commits resumes the same `pr-<N>` box and
re-fetches. One-time setup: `pnpm exec sandbox login`; cloning the private repo
uses `$GH_TOKEN` or `gh auth token`. Stop with `pnpm exec sandbox stop pr-<N>`
(resumable) or `remove pr-<N>` to delete.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the development workflow.
