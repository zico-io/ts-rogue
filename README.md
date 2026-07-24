# ts-rogue

A deterministic TypeScript terminal dungeon crawler built with Ink and rot.js.

The playable loop runs from village to overworld to first-person dungeon and
turn-based battle, then returns through loot, recovery, and saving.

## Quick start

```bash
corepack enable
pnpm install
pnpm game
```

## Requirements

- Node.js 24 or newer
- pnpm 11.7.0, pinned by `packageManager`
- Git

The tmux play harness also requires `tmux`.

## Repository map

| Path | Purpose |
| --- | --- |
| [`src/engine/`](src/engine/README.md) | Deterministic game state, world, combat, loot, and persistence contract |
| [`src/ui/`](src/ui/README.md) | Ink scenes, controls, responsive terminal layout, and runtime diagnostics |
| [`src/web/`](src/web/README.md) | PixiJS browser renderer sharing the engine core |
| [`agent/`](agent/README.md) | Eve project agent, integrations, and sandbox lifecycle |
| [`PROJECT_PLAN.md`](PROJECT_PLAN.md) | Product scope, architecture decisions, and phase ordering |
| [`.botfile/memory/`](.botfile/memory/index.md) | Curated, provenance-backed agent memory |

## Common tasks

| Task | Command |
| --- | --- |
| Run all checks | `pnpm check` |
| Run the game | `pnpm game` |
| Run the game with the developer console | `pnpm game:dev` |
| Run the browser renderer locally | `pnpm web:dev` |
| Drive a deterministic tmux session | `pnpm play start [seed] [cols] [rows]` |
| Iterate with the game beside a pi assistant (on Eve's gateway/model) | `pnpm play dev [seed] [cols] [rows]` |
| Test a pull request in a Vercel Sandbox | `pnpm pr:sandbox <PR#>` |
| Run the Eve agent locally | `pnpm eve:dev` |
| Type-check | `pnpm typecheck` |
| Run tests | `pnpm test` |
| Lint | `pnpm lint` |
| Format | `pnpm format` |
| Record a release-facing change | `pnpm changeset` |
| Apply pending versions and changelogs | `pnpm version-packages` |

## Development

Work is tracked in Linear and reviewed through GitHub pull requests. See
[`CONTRIBUTING.md`](CONTRIBUTING.md) for the workflow.

`pnpm play` drives the real application in a detached tmux session. Use
`pnpm play key <tokens>`, `pnpm play frame`, and `pnpm play stop` to interact
with it and capture the terminal output.

`pnpm pr:sandbox <PR#>` opens an interactive Vercel Sandbox for the pull
request. Authenticate once with `pnpm exec sandbox login`; private repository
cloning uses `GH_TOKEN` or `gh auth token`.
