# Product

## Shipped state

The repository contains a product plan, an engineering harness, and a runnable Ink shell that boots to a title screen, loads any existing save, and then routes into a real Village hub plus three still-placeholder scenes (overworld, dungeon, battle).

The toolchain is in place: TypeScript, Vitest, and Biome on Node 24, with Ink and rot.js as the locked runtime stack. `src/engine` holds the UI-free spine that later phases build on: a seeded RNG wrapper over rot.js (`src/engine/rng`), the serializable `GameState` with a pure reducer and store (`src/engine/state`), and a party/economy data model (`src/engine/entities/party.ts`). `GameState` carries `party` (an array of `PartyMember`, modeled as an array even though the milestone starts with a single hero, per PROJECT_PLAN §10), `gold`, and `inventory` (owned, unequipped item stacks) alongside `seed`, `rngState`, `scene`, and `log`. `newGame` seeds a fresh run, creates one deterministic starting hero (`createStartingHero`), grants 50 starting gold, and logs the seed into `GameState.log`; a `Log` event appends further messages immutably. `src/data/shops.ts` defines a static village shop catalog (`SHOP_ITEMS`) and the buy/sell price rule (`sellPriceFor`, half of buy price, rounded down). The reducer (`src/engine/state/store.ts`) also understands `InnHeal` (fully heals the party for `party.length * INN_COST_PER_MEMBER` gold, no-op if unaffordable), `StoreBuy`, and `StoreSell` (against the shop catalog and `gold`/`inventory`, no-op on unknown items or insufficient gold/quantity) - all pure, logged, and covered by unit tests. Biome enforces that `src/engine` never imports UI code.

`src/persistence/save.ts` exposes whole-state JSON `serialize`/`deserialize`, and persists a full `GameState` to a real single-slot sqlite database via Node's built-in `node:sqlite` (`saveGame`/`loadGame`, default path `./save.db`, upserted on every save; `loadGame` returns `undefined` before any save exists).

`pnpm game` runs the Ink shell (`src/app.tsx`). On boot it calls `loadGame()`: if a save exists, the `GameStore` starts from that state and the title screen reads "Press any key to continue"; otherwise it falls back to `newGame(Date.now())` and the title screen reads "Press any key to start". Either way, the first keypress only flips into the in-game router - it no longer unconditionally starts a fresh run, so a loaded save survives that keypress. Once started, number keys `1`-`4` dispatch `ChangeScene` to the village, overworld, dungeon, and battle screens (`src/ui/screens`); `q` or Ctrl+C exits.

The Village screen (`src/ui/screens/VillageScreen.tsx`) is real gameplay, not a placeholder: it shows the party's name/HP/MP and current gold, then lets the player pick one of three buildings with up/down + Enter or the `i`/`c`/`s` shortcuts, and `Esc` returns from a building to the overview.
- **Inn** (`src/ui/screens/village/InnView.tsx`) previews the rest cost as `party.length * INN_COST_PER_MEMBER` and dispatches `InnHeal` on Enter.
- **Church** (`src/ui/screens/village/ChurchView.tsx`) calls `saveGame(state)` on Enter (I/O lives in the UI layer, not the engine) and dispatches a `Log` event ("Game saved" or "Failed to save game") so the outcome shows in the shared message log. Loading only happens at boot, per PROJECT_PLAN §8.
- **Store** (`src/ui/screens/village/StoreView.tsx`) lists `SHOP_ITEMS` with buy price, `sellPriceFor` sell price, and owned quantity; up/down selects an item, `b`/`s` dispatch `StoreBuy`/`StoreSell` for one unit at a time.

The overworld, dungeon, and battle screens (`src/ui/screens/{OverworldScreen,DungeonScreen,BattleScreen}.tsx`) are still thin wrappers around the shared `PlaceholderScene`, which renders the scene name plus the shared `MessageLog` component (`src/ui/components/MessageLog.tsx`) fed from `GameState.log`. No UI snapshot tests exist yet, per PROJECT_PLAN §9.

The repository also ships an Eve project agent under `agent/`. It receives work through Linear, uses Linear as its tracker, and runs repository tasks in Vercel Sandboxes pre-warmed with the repository and locked pnpm dependencies. Linear sessions show tool calls, delegation, reasoning, and rich Markdown progress from root or delegated work as native activities, and present approval prompts as native selections. Linear tools run without human approval, and progress stays in the Agent Session instead of issue comments. Eve performs a bounded root orientation using the assigned Linear identifier and one batched repository read, then delegates ordinary implementation to one coding child with a complete orientation packet. The child skips repeated global orientation and reads only task-relevant code. GitHub credentials are brokered through Vercel Connect and do not enter the sandbox; Eve uses `git` and the GitHub REST API directly instead of probing for credentials or creating test branches.

The intended playable loop, architecture, phases, and definition of done are maintained in [`PROJECT_PLAN.md`](../PROJECT_PLAN.md). Linear holds issue status, ownership, and priority.

## Documentation contract

This document describes shipped behavior only. Update it in the same pull request when product behavior changes. Update `README.md` when setup, commands, requirements, or top-level layout change.

`pnpm docs:check` validates local Markdown links. In pull requests, it also rejects changes to product code or runtime configuration that do not update `docs/product.md`.
