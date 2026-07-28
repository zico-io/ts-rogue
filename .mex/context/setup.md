---
name: setup
description: Dev environment setup and commands. Load when setting up the project for the first time or when environment issues arise.
triggers:
  - "setup"
  - "install"
  - "environment"
  - "getting started"
  - "how do I run"
  - "local development"
edges:
  - target: context/stack.md
    condition: when specific technology versions or library details are needed
  - target: context/web-renderer.md
    condition: when running or building the browser renderer
grounds_to: []
last_updated: 2026-07-28
---

# Setup

## Prerequisites

- Node.js 24 or newer (the terminal save uses built-in `node:sqlite`).
- pnpm 11.7.0 - `corepack enable` (pinned via `packageManager`).
- Git.
- `tmux` (only for the `pnpm play` terminal harness).

## First-time Setup

1. `corepack enable`
2. `pnpm install`
3. `pnpm game` - runs the terminal game (no env needed).
4. Optional: create `.env.local` for dev-console Linear reporting and the pi
   assistant (`AI_GATEWAY_API_KEY`, `VERCEL_OIDC_TOKEN`, `LINEAR_TEAM_KEY`).

## Environment Variables

None are required to play. Conditional/optional:
- `AI_GATEWAY_API_KEY` (required for `pnpm play dev`'s pi assistant pane - a
  real inference key; the OIDC token cannot do inference).
- `VERCEL_OIDC_TOKEN` (optional) - lets the terminal dev console fetch Linear
  credentials via Vercel Connect for filing issues.
- `LINEAR_TEAM_KEY` (optional) - overrides the default `ROG` Linear team.
- Loaded from `.env.local` via `--env-file-if-exists` in the dev scripts.

## Common Commands

- `pnpm game` - run the terminal game.
- `pnpm game:dev` - terminal game with the developer console (backtick toggles).
- `pnpm web:dev` - run the PixiJS browser renderer locally (prints a local URL).
- `pnpm web:build` - static Next.js export of the browser renderer.
- `pnpm check` - full gate: `typecheck` (tsgo) + `test` (vitest) + `lint` (biome).
- `pnpm test` / `pnpm test:unit` - run the vitest suite.
- `pnpm lint` / `pnpm format` - biome check / write.
- `pnpm play start [seed] [cols] [rows]` - drive the real terminal UI in a
  detached tmux session; interact with `pnpm play key <tokens>`,
  `pnpm play frame`, `pnpm play stop`.

## Common Issues

**Wrong Node version:** `node:sqlite` requires Node 24+. `nvm use 24` (or newer)
before `pnpm game`.
**Next build silently downgrades `typescript`:** keep both `typescript` (stable
v5) and `@typescript/native-preview`; typecheck runs `tsgo`, not the stable
compiler. See `context/decisions.md`.
**Engine change works in one UI but not the other:** run both `pnpm game` and
`pnpm web:dev`; `pnpm check` cannot verify a change makes sense in Pixi. See
`patterns/debug-renderer-divergence.md`.
