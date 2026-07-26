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
  entrances, and a seeded encounter meter. The village occupies a 2x2
  footprint (`world/landmarks.ts`); `map.village` is its top-left anchor
  cell, every covered cell carries the `village` tile so movement and the
  village-entry trigger work from any of the four cells, and generation
  rejects a footprint that would overlap impassable terrain or another
  landmark.
- Fast travel: evac leaves any dungeon (outside battle) for the overworld on
  the entrance tile without touching dungeon progress, and zoom teleports
  between landmarks (village, dungeon entrances) already visited this run.
  Neither triggers an encounter or advances the encounter meter.
- Dungeons contain deterministic rooms, corridors, chests, stairs, wandering
  encounters, and a boss floor.
- Battles support Attack, Skill, Item, Defend, and Flee actions in a fixed
  initiative order for each round. Skills and monster attacks carry an
  element and may apply status effects (poison, burn, stun, slow, wet, oiled,
  chilled, frozen, shocked); effects tick at the start of the afflicted
  actor's turn and are cleared entirely when battle ends. Antidote cures
  poison and Thermal Salts cure burn/chilled; every Heal-kind skill also
  cleanses the caster's own status effects on cast (see the comment on
  `SkillKind` in `combat/skills.ts` for the full Heal-cleanse rationale).
- Loot combines item bases, rarity, prefixes, suffixes, and optional
  monster-specific implicit properties.
- Village events cover resting, buying, selling, and equipment; saving stays at
  the UI and persistence boundary.

Run the engine and persistence tests with `pnpm test:unit`. Product scope and
design decisions live in [`PROJECT_PLAN.md`](../../PROJECT_PLAN.md).
