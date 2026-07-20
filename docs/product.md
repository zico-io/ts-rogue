# Product

## Shipped state

The repository contains a product plan, an engineering harness, and a runnable Ink shell that boots to a title screen and routes between placeholder scenes. There is no gameplay wired into the UI yet.

The toolchain is in place: TypeScript, Vitest, and Biome on Node 24, with Ink and rot.js as the locked runtime stack. `src/engine` holds the UI-free spine that later phases build on: a seeded RNG wrapper over rot.js (`src/engine/rng`), the serializable `GameState` with a pure reducer and store (`src/engine/state`), and a party/economy data model (`src/engine/entities/party.ts`). `GameState` now carries `party` (an array of `PartyMember`, modeled as an array even though the milestone starts with a single hero, per PROJECT_PLAN §10), `gold`, and `inventory` (owned, unequipped item stacks) alongside `seed`, `rngState`, `scene`, and `log`. `newGame` seeds a fresh run, creates one deterministic starting hero (`createStartingHero`), grants 50 starting gold, and logs the seed into `GameState.log`; a `Log` event appends further messages immutably. `src/data/shops.ts` defines a static village shop catalog (`SHOP_ITEMS`) and the buy/sell price rule (`sellPriceFor`, half of buy price, rounded down). The reducer (`src/engine/state/store.ts`) now also understands `InnHeal` (fully heals the party for `party.length * INN_COST_PER_MEMBER` gold, no-op if unaffordable), `StoreBuy`, and `StoreSell` (against the shop catalog and `gold`/`inventory`, no-op on unknown items or insufficient gold/quantity) - all pure, logged, and covered by unit tests. Biome enforces that `src/engine` never imports UI code.

`src/persistence/save.ts` still exposes whole-state JSON `serialize`/`deserialize`, and now also persists a full `GameState` to a real single-slot sqlite database via Node's built-in `node:sqlite` (`saveGame`/`loadGame`, default path `./save.db`, upserted on every save; `loadGame` returns `undefined` before any save exists). None of this engine/persistence work is wired into the Ink UI yet - the village screen does not call the inn/store reducer events or trigger save/load; that wiring is a follow-up task.

`pnpm game` runs the Ink shell (`src/app.tsx`). It owns a `GameStore` and shows a `TitleScreen` until any key is pressed, at which point it dispatches `NewGame` with a fresh seed and switches to the in-game router. Once started, number keys `1`-`4` dispatch `ChangeScene` to the village, overworld, dungeon, and battle placeholder screens (`src/ui/screens`); `q` or Ctrl+C exits. Each placeholder screen renders its scene name plus a shared `MessageLog` component (`src/ui/components/MessageLog.tsx`) fed from `GameState.log`, so the log is visible across every scene. No real village/overworld/dungeon/battle gameplay exists in the UI yet.

The repository also ships an Eve project agent under `agent/`. It receives work through Linear, uses Linear as its tracker, and runs repository tasks in Vercel Sandboxes pre-warmed with the repository and locked pnpm dependencies. Linear sessions show tool calls, delegation, reasoning, and rich Markdown progress from root or delegated work as native activities, and present approval prompts as native selections. Linear tools run without human approval, and progress stays in the Agent Session instead of issue comments. Eve owns ordinary single-issue work directly and delegates only bounded independent subtasks. GitHub credentials are brokered through Vercel Connect and do not enter the sandbox; Eve uses `git` and the GitHub REST API directly instead of probing for credentials or creating test branches.

The intended playable loop, architecture, phases, and definition of done are maintained in [`PROJECT_PLAN.md`](../PROJECT_PLAN.md). Linear holds issue status, ownership, and priority.

## Documentation contract

This document describes shipped behavior only. Update it in the same pull request when product behavior changes. Update `README.md` when setup, commands, requirements, or top-level layout change.

`pnpm docs:check` validates local Markdown links. In pull requests, it also rejects changes to product code or runtime configuration that do not update `docs/product.md`.
