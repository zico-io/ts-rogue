# Product

## Shipped state

The repository contains a product plan, an engineering harness, and the TypeScript toolchain plus engine spine. It does not yet contain a playable build.

The toolchain is in place: TypeScript, Vitest, and Biome on Node 24, with Ink and rot.js as the locked runtime stack. `src/engine` holds the UI-free spine that later phases build on: a seeded RNG wrapper over rot.js (`src/engine/rng`), the serializable `GameState` with a pure reducer and store (`src/engine/state`), and whole-state JSON save/load (`src/persistence`). Biome enforces that `src/engine` never imports UI code. No screens, gameplay, or persistence backend exist yet.

The repository also ships an Eve project agent under `agent/`. It receives work through Linear, uses Linear as its tracker, and runs repository tasks in Vercel Sandboxes pre-warmed with the repository and locked pnpm dependencies. Linear sessions show tool calls, delegation, and reasoning as native activities, and present approval prompts as native selections. Read-only Linear tools run without approval; mutations require approval on first use. GitHub credentials are brokered through Vercel Connect and do not enter the sandbox.

The intended playable loop, architecture, phases, and definition of done are maintained in [`PROJECT_PLAN.md`](../PROJECT_PLAN.md). Linear holds issue status, ownership, and priority.

## Documentation contract

This document describes shipped behavior only. Update it in the same pull request when product behavior changes. Update `README.md` when setup, commands, requirements, or top-level layout change.

`pnpm docs:check` validates local Markdown links. In pull requests, it also rejects changes to product code or runtime configuration that do not update `docs/product.md`.
