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
| Run the Eve agent locally | `pnpm eve:dev` |
| Type-check | `pnpm typecheck` |
| Run tests | `pnpm test` |
| Lint | `pnpm lint` |
| Format | `pnpm format` |
| Check documentation | `pnpm docs:check` |

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the development workflow.
