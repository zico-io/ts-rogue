---
name: agents
description: Always-loaded project anchor. Read this first. Contains project identity, non-negotiables, commands, and pointer to ROUTER.md for full context.
last_updated: 2026-07-28
---

# ts-rogue

## What This Is
A deterministic TypeScript terminal dungeon crawler (Ink + rot.js) with a second
PixiJS browser renderer, both driving one engine-owned game state.

## Non-Negotiables
- The engine (`src/engine`) is pure and UI-independent — never import `src/ui`,
  `ink`, or `pixi.js` into it, and never mutate `GameState`.
- All state transitions go through `reduce` behind `GameStore.dispatch`; a new
  player action is a `GameEvent` + `reduce` case, never renderer-local logic.
- Determinism: no `Math.random`; random outcomes consume the seeded `Rng`,
  blocked/no-op actions consume none.
- Respect the renderer split — no `pixi.js` in `src/app.tsx`/`src/ui`; no
  `ink`/Node builtins/DOM globals in `src/web` (biome fails CI otherwise).
- Engine changes must keep BOTH `pnpm game` and `pnpm web:dev` working.

## Commands
- Run (terminal): `pnpm game` — with dev console: `pnpm game:dev`
- Run (browser): `pnpm web:dev` — build: `pnpm web:build`
- Check all: `pnpm check` (typecheck + test + lint)
- Test: `pnpm test` — Typecheck: `pnpm typecheck` (tsgo) — Lint: `pnpm lint` (biome) — Format: `pnpm format`

## Code Graph
The repo is indexed into `.mex/graph.db`. Prefer graph commands over grepping or reading files.
- Explore a task with `mex graph scope "<task>"` first — it returns a compact JSONL manifest (`meta`, `fact`s, `summary`). Treat any source the graph returns as ALREADY READ; do not re-open those files.
- Pick 1-3 relevant node ids from the manifest and expand only those with `mex graph get <id> --detail source`.
- If you already know the symbol, skip scope: use `mex graph query <who-calls|what-calls|where-defined> <symbol>`, or `mex graph get <id>`.
- Before editing a symbol, run `mex impact <symbol|file>` to see affected callers and scaffold memory.
- If a result is `truncated`, do NOT repeat the broad query — narrow the task or use the summary's `suggestedNextCommands`. Scale through a few focused calls, never one giant response.
- During `mex sync`, adjudicate any AMBIGUOUS grounding; after repairs, ensure the refreshed grounding is re-emitted.

## Scaffold Growth
After meaningful work, run GROW:
- Ground: what changed in reality?
- Record: update `ROUTER.md` and relevant `context/` files
- Orient: create or update a `patterns/` runbook if this can recur
- Write: bump `last_updated` on changed scaffold files and run `mex log` when rationale matters

The scaffold grows from real work, not just setup. See the GROW step in `ROUTER.md` for details.

## Navigation
At the start of every session, read `ROUTER.md` before doing anything else.
For full project context, patterns, and task guidance — everything is there.
