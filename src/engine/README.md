# Game engine

The engine owns deterministic, UI-independent game state and rules.

## Architecture

`GameState` is a serializable tree containing the seed and RNG state, party,
economy, inventory, world, dungeon, battle, log, and run flags. `reduce` applies
typed events without I/O, while `GameStore` validates each result and retains a
bounded debug journal.

| Area | Responsibility |
| --- | --- |
| [`state/`](state/) | State types, reducer, store, validation, and incident boundaries |
| [`rng/`](rng/) | Serializable seeded random number generation |
| [`world/`](world/) | Overworld and dungeon generation, traversal, encounters, and the fast-travel waypoint registry |
| [`combat/`](combat/) | Initiative, actions, damage, rewards, and defeat handling |
| [`loot/`](loot/) | Item generation, affixes, monster-specific drops, and equipment |
| [`entities/`](entities/) | Party and inventory models |
| [`../data/`](../data/) | Typed classes, monsters, shops, dungeons, items, affixes, and loot tables |
| [`../persistence/`](../persistence/) | Single-slot SQLite save/load for the complete state |

The engine may read static definitions from `src/data`, but it never imports
from `src/ui`. The application and UI dispatch events and perform external I/O.

## Determinism and persistence

- Random outcomes consume the serialized `Rng` state.
- Blocked actions are side-effect-free and consume no randomness.
- Overworld and dungeon layouts are reproducible from their seed inputs.
- Combat, loot, exploration, and economy changes flow through the reducer.
- Saves serialize the whole state to `save.db`; older supported saves are
  backfilled with required run flags and the default Warrior class during
  deserialization.

Normal defeat revives the party in the village with one HP and half its gold.
Permadeath marks the run as over and clears its active battle and dungeon; the
UI then clears the persisted save. Victory awards experience, gold, and seeded
loot before returning to the originating scene.

## Gameplay systems

- Warrior, Rogue, and Wizard classes define starting stats, per-level growth,
  and known skills through the `CLASSES` data table.
- The overworld contains passable biomes, a village, reachable dungeon
  entrances, and a seeded encounter meter.
- Fast travel: evac leaves any dungeon (outside battle) for the overworld on
  the entrance tile without touching dungeon progress, and zoom teleports
  between landmarks (village, dungeon entrances) already visited this run.
  Neither triggers an encounter or advances the encounter meter.
- Dungeons contain deterministic rooms, corridors, chests, stairs, wandering
  encounters, and a boss floor.
- Battles support Attack, Skill, Item, Defend, and Flee actions in a fixed
  initiative order for each round.
- Loot combines item bases, rarity, prefixes, suffixes, and optional
  monster-specific implicit properties.
- Village events cover resting, buying, selling, and equipment; saving stays at
  the UI and persistence boundary.
- The field backpack for generated gear is capped (`FIELD_BACKPACK_CAP`); the
  village stash holds unlimited overflow. An opt-in loot filter auto-dismantles
  unwanted drops for gold, and a drop that would overflow the field cap raises a
  pending swap-or-dismantle triage the caller must resolve before either backpack
  changes further. Heal items can be used in the field outside battle via
  `UseFieldItem`, sharing the same heal table as battle item use.

Run the engine and persistence tests with `pnpm test:unit`. Product scope and
design decisions live in [`PROJECT_PLAN.md`](../../PROJECT_PLAN.md).
