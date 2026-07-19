# ts-rogue

A TypeScript terminal dungeon crawler repository in its pre-implementation stage.

The repository contains the playable-loop specification and the coding harness. It does not yet ship an executable game.

## Requirements

- Node.js 24 or newer
- pnpm 10 or newer
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
| [`.botfile/memory/`](.botfile/memory/index.md) | Curated, provenance-backed agent memory |
| [`AGENTS.md`](AGENTS.md) | Coding-agent operating instructions |

## Workflow

Work is tracked in Linear. GitHub pull requests are used for review and merge. Each pull request links its Linear issue and updates product documentation when behavior, commands, or requirements change.

| Task | Command |
| --- | --- |
| Run all repository checks | `pnpm check` |
| Type-check | `pnpm typecheck` |
| Run tests | `pnpm test` |
| Lint | `pnpm lint` |
| Format | `pnpm format` |
| Check documentation | `pnpm docs:check` |

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the development workflow.

