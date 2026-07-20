# AGENTS.md - portable agent behavior (SSOT)

**Agent:** `gilbert` - 24/7 product agent with persistent, portable memory.

## Start here

1. Read `.botfile/memory/index.md` and only the referenced topic files needed for the task.
2. Read `PROJECT_PLAN.md` for product scope and phase ordering.
3. Use Linear as the work tracker and Git/GitHub for branches, commits, reviews, and releases.
4. Reproduce bugs in an end-to-end user environment before changing code.
5. Run `pnpm check` before handing work off.

## Operating principles

- **Distilled, not raw.** Store extracted facts with source, date, and relevance, never conversation transcripts.
- **Provenance required.** Every memory fact carries `<source: ..., YYYY-MM-DD>`.
- **Good code is self documenting.** Comments explain non-obvious behavior or public APIs only.
- **Upsert, not append-only.** Correct or delete stale facts instead of accumulating them.
- **No em dashes.** Use a plain hyphen.
- **No agent co-authors.** Never add an agent name to commits or pull requests.
- **Generated files are generated.** Change their source or generator, then regenerate them.
- **TypeScript imports stay TypeScript-native.** Use extensionless relative imports, never `.js` specifiers.
- **Quality over cost.** Prefer simple, robust code over fast scaffolding.
- **Verify, don't assume.** Exercise the real user path first.
- **Pixel perfect.** Inspect terminal UI output closely at supported sizes.

## Product boundaries

- Keep `src/engine` independent from `src/ui`.
- Route randomness through seeded RNG state so bugs are reproducible.
- Keep `GameState` serializable and reducers pure.
- Complete phases in `PROJECT_PLAN.md` in order. Do not build later-phase depth early.
- Update `docs/product.md` in the same pull request when shipped behavior changes.

## Memory discipline

Curated facts live in `.botfile/memory/`. Read `index.md` first. Keep one topic per file under `domain/` and one tool per file under `tools/`. Every fact ends with inline provenance:

```text
- <fact> <source: ..., YYYY-MM-DD>
```

Canonical entities live in `.botfile/entities/entities.jsonl`, one JSON object per line. Refer to entities by `canonical_id`; add aliases instead of duplicate records.

## Git, GitHub, and Linear

- Start from a Linear issue and use its suggested branch name when available.
- Keep one issue per branch. Put the Linear issue identifier in the pull request.
- Use focused commits. Do not rewrite or discard work you did not create.
- GitHub pull requests are the review and merge boundary; Linear is the source of truth for status and priority.
- Treat stale product documentation as a bug. `pnpm docs:check` enforces links and documentation coupling.

## Orchestration protocol

Multi-agent work runs on herdr for placement, process, and status, plus the `orbal-net` CLI talking to a per-mission server on the host. Use no more than three layers:

- **L1 orchestrator** - the current pane; joins `mission-<feature>` and talks to leads.
- **L2 leads** - one herdr tab each; joins `mission-<feature>` and its own `squad-<lead>`.
- **L3 workers** - splits inside a lead's tab; joins only `squad-<lead>` and never spawns agents.

The orchestrator never messages workers directly. Stand up or tear down a fleet from a roster with `orchestration/spawn.py up` or `orchestration/spawn.py down`, or use `/spawn-team`. Spawn only the teams needed by the mission. Harnesses may be Claude, Codex, or Pi. See `.botfile/memory/tools/orchestration.md` before orchestrating.

Agents publish typed status with `orbal-net event <room> <kind>` and `orbal-net progress <room> N/M`. Valid event kinds are `task-start`, `done`, `error`, `abort`, `step`, `phase`, `blocked`, and `handoff`. Use `orbal-net tui` for the live dashboard and `orbal-net peek <room>` for non-consuming message inspection. Never monitor with `read`, which advances the cursor. Wait for tasks with `orbal-net recv <room>` rather than shell polling.

Spawned agents have no GitHub or network access and use a local mirror origin. The orchestrator handles live GitHub operations, including push and pull-request creation through `spawn.py bridge-pr <feature>`, releases, and repository settings. Agents prepare artifacts as files or text.
