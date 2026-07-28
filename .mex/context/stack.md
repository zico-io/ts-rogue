---
name: stack
description: Technology stack, library choices, and the reasoning behind them. Load when working with specific technologies or making decisions about libraries and tools.
triggers:
  - "library"
  - "package"
  - "dependency"
  - "which tool"
  - "technology"
edges:
  - target: context/decisions.md
    condition: when the reasoning behind a tech choice is needed
  - target: context/conventions.md
    condition: when understanding how to use a technology in this codebase
  - target: context/web-renderer.md
    condition: when working with Pixi, Next.js, or the browser toolchain split
grounds_to: []
last_updated: 2026-07-28
---

# Stack

## Core Technologies

- **TypeScript** - two compilers on purpose: stable `typescript` v5.9 for
  editors + the Next.js build (needs the compiler API), and
  `@typescript/native-preview` (`tsgo`) as the fast checker of record.
  `pnpm typecheck` runs `tsgo --noEmit`. See `context/decisions.md`.
- **Node.js 24+** - required runtime (uses `node:sqlite`). pnpm 11.7.0 pinned
  via `packageManager`; enable with `corepack enable`.
- **React 19 + Ink 7** - the terminal UI is a React renderer for the terminal
  (`src/app.tsx`).
- **PixiJS (pixi.js)** - the browser renderer's WebGL layer (`src/web`).
- **Next.js** - static-friendly app shell hosting the Pixi canvas and the eve
  agent (`src/web/app`, workspace package `@ts-rogue/web`).
- **rot-js** - roguelike toolkit utilities (map/FOV primitives).

## Key Libraries

- **rot-js** (not a hand-rolled dungeon generator) - roguelike primitives.
- **zod v4** - schema validation (engine state validation, tool/agent I/O).
- **ai (Vercel AI SDK) v7** + **eve** - the durable backend agent in `agent/`.
- **@libsql/client** - libSQL client used by the agent side.
- **vitest v4** (not jest) - all unit tests, run with `pnpm test:unit`.
- **biome v2** (not ESLint/Prettier) - lint + format, and it enforces the
  cross-renderer import guardrails (see `context/web-renderer.md`).
- **playwright** - used by the web play/screenshot harness.
- **@changesets/cli** - release-facing changelog entries (`pnpm changeset`).

## What We Deliberately Do NOT Use

- No second renderer abstraction - Ink and Pixi never share a drawing layer;
  they share only framework-free interaction/chrome modules.
- No `pixi.js` import in `src/app.tsx` / `src/ui/**`, and no `ink` / Node
  builtins / DOM globals in `src/web/**` - enforced by biome overrides; a
  cross-boundary import fails CI.
- No ESLint/Prettier/jest - biome and vitest only.
- No ORM - persistence is a single whole-state-JSON blob, not a relational
  schema.

## Version Constraints

- `typescript` is stable **v5**, NOT the TS7 native preview - Next's build
  loads the compiler API which the preview does not expose. The preview lives
  under `@typescript/native-preview` (`tsgo`) purely for typecheck speed. Do
  not "upgrade" `typescript` to the preview; it will break the Next build.
- Node **24+** is mandatory (the terminal save uses the built-in `node:sqlite`).
