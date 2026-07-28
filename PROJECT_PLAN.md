# Terminal Dungeon Crawler — Playable Loop Project Plan

> **Goal of this milestone:** Lock in a complete, replayable *core loop*:
> **Village hub → Overworld (top-down) → Dungeon (first-person) → Turn-based encounter → Loot → back to Village.**
>
> This document scaffolds the TypeScript implementation. It is a *playable-loop* plan, not a full-game GDD. Everything here is scoped to prove the loop is fun and structurally sound before adding depth.
>
> **Roadmap only.** Shipped product truth lives in the golden SSOT under `.botfile/memory/domain/` (see `index.md`); this file is the original plan and its checklists are historical.

---

## 1. Stack & Architecture Decisions (locked)

| Concern | Choice | Rationale |
|---|---|---|
| Language | **TypeScript (Node 20+)** | Direct skill reuse; fastest iteration |
| Terminal UI | **Ink** (React-for-CLI) | Component model for the many distinct screens (map, dungeon view, battle, shop menus) |
| Roguelike toolkit | **rot.js** | FOV, pathfinding, RNG (seeded), dungeon/map generation, scheduler |
| Persistence | **node:sqlite** (or `better-sqlite3`) | Save/load, inventory, run state, seeded world |
| Rendering (dungeon) | Hand-rolled ASCII first-person raycaster (see §5) | rot.js is top-down only; FP view is custom |
| State management | Central `GameStore` (reducer/event pattern) | Deterministic, testable, save-friendly |
| Package/tooling | pnpm + tsx (dev) + vitest (tests) | Matches existing workflow |

### Repo layout (monorepo-friendly)
```
/src
  /engine        # pure logic, no rendering — fully unit-testable
    /state       # GameStore, reducers, events
    /rng         # seeded RNG wrappers over rot.js
    /combat      # turn resolution, damage, initiative
    /loot        # affixes, tables, monster-implicit pools
    /world       # overworld gen, dungeon gen, tile maps
    /entities    # actors, party, monsters, items (data + behavior)
  /ui            # Ink components ONLY — read from store, dispatch events
    /screens     # OverworldScreen, DungeonScreen, BattleScreen, VillageScreen
    /components  # HUD, MessageLog, Minimap, InventoryPanel
  /data          # static JSON/TS: monster defs, item bases, affixes, loot tables
  /persistence   # sqlite schema, save/load serializers
  /app.tsx       # Ink root + scene router
/tests
```

**Golden rule:** `/engine` never imports from `/ui`. The engine emits state; Ink renders it. This keeps combat/loot deterministic and testable, and makes a future Rust rewrite (Ratatui + bevy_ecs) a port of clean logic rather than a rescue.

---

## 2. The Playable Loop (target end-state of this milestone)

```
        ┌─────────────────────────────────────────────┐
        │                  VILLAGE (hub)               │
        │  Inn (heal) · Church (save) · Store (buy/sell)│
        └───────────────┬──────────────────▲──────────┘
                        │ leave town        │ return
                        ▼                    │
        ┌─────────────────────────────────────────────┐
        │        OVERWORLD  (rot.js top-down map)      │
        │   walk tiles · random encounters · dungeon   │
        │   entrances scattered across the map         │
        └───────────────┬─────────────────────────────┘
                        │ enter dungeon
                        ▼
        ┌─────────────────────────────────────────────┐
        │   DUNGEON  (first-person ASCII crawler)      │
        │   grid movement · fog · chests · stairs      │
        │   boss room at depth floor                   │
        └───────────────┬─────────────────────────────┘
                        │ step into enemy / trigger
                        ▼
        ┌─────────────────────────────────────────────┐
        │   BATTLE  (turn-based, first-person framing)  │
        │   party vs enemy front · initiative order    │
        │   win → LOOT DROP → back to dungeon           │
        └─────────────────────────────────────────────┘
```

A build "counts" as the locked loop when a player can:
1. Start in the village, buy a starting item, save at the church.
2. Walk the overworld and enter a dungeon.
3. Crawl the dungeon in first-person, open a chest, fight a random encounter.
4. Defeat a floor boss, receive a **monster-implicit** drop.
5. Return to the village, sell loot, heal, save, and repeat.

---

## 3. Milestones & Phasing

> Each phase ends in a *playable vertical slice*. Do not advance until the prior slice runs end-to-end.

### Phase 0 — Skeleton & Scene Router *(foundation)*
- [ ] Ink app boots, renders a title screen, quits cleanly.
- [ ] `GameStore` with event dispatch + scene router (`village | overworld | dungeon | battle`).
- [ ] Seeded RNG wrapper; log the seed on new game.
- [ ] MessageLog component (shared across all scenes).
- **Slice:** switch between empty placeholder scenes via keypress.

### Phase 1 — Village Hub *(the anchor)*
- [ ] Village screen with selectable buildings (Inn, Church, Store).
- [ ] **Inn:** restore party HP/MP for gold.
- [ ] **Church:** write save to sqlite; load on boot.
- [ ] **Store:** buy/sell against a static shop inventory; gold economy.
- [ ] Party data model (stats, HP/MP, equipment slots, inventory).
- **Slice:** manage party, save, reload, and see state persist.

### Phase 2 — Overworld *(traversal + encounter trigger)*
- [ ] rot.js top-down map (biome tiles: grass/forest/mountain/water impassable).
- [ ] Player token movement, camera follow, minimap.
- [ ] Dungeon entrance tiles placed on the map.
- [ ] Random-encounter step counter (danger/step accumulator → battle trigger).
- **Slice:** walk from village, trigger a random encounter, reach a dungeon entrance.

### Phase 3 — Dungeon (first-person) *(the crawler identity)*
- [ ] Grid-based dungeon gen (rooms + corridors) with a discrete tile map.
- [ ] First-person ASCII raycast/prebuilt-view renderer (see §5).
- [ ] Grid movement: turn L/R, step F/B; fog-of-war / explored tracking.
- [ ] Interactables: chests, stairs down, boss room marker.
- [ ] Encounter triggers (wandering + fixed).
- **Slice:** descend a dungeon in first-person, open a chest, reach the boss room.

### Phase 4 — Turn-Based Battle *(the payoff)*
- [ ] Battle scene with first-person framing (enemy sprites/ASCII art facing player, à la Dragon Quest / Wizardry).
- [ ] Initiative order; party + enemy turns.
- [ ] Actions: Attack, Skill/Spell (MP), Item, Defend, Flee.
- [ ] Damage formula, hit/crit, death/KO, victory/defeat resolution.
- [ ] XP award + level-up (powerscaling curve).
- **Slice:** win and lose a battle; level up; return to dungeon on victory.

### Phase 5 — Loot System *(the hook)*
- [ ] Item bases + affix system (prefix/suffix, Diablo-style rolls).
- [ ] Rarity tiers (common → magic → rare → unique) with weighted rolls.
- [ ] Loot tables per enemy tier; chest tables; boss tables.
- [ ] **Monster-implicit pools** (see §6) — boss/enemy-type-specific dedicated drops.
- [ ] Equip/compare/sell flow tied back into village Store.
- **Slice:** kill boss → roll from its implicit pool → equip → sell dupes in town.

### Phase 6 — Loop Lock & Polish *(prove it's fun)*
- [ ] Full loop runs end-to-end without dead-ends.
- [ ] Balance first-pass: gold, XP, drop rates, encounter frequency.
- [ ] Save/restore mid-run integrity check.
- [ ] Death handling (return to village vs. permadeath toggle).
- **Slice:** a full 20–30 min play session that loops naturally.

---

## 4. Core Systems Spec

### 4.1 State model
- Single serializable `GameState` tree: `{ seed, party, gold, inventory, worldState, dungeonState, battleState, scene, flags }`.
- Reducers are pure `(state, event) => state`. All randomness routed through the seeded RNG stored on state → deterministic replays and reproducible bug reports.

### 4.2 Party & progression
- Party of 1–4 actors. Stats: `STR, AGI, VIT, INT, and derived HP/MP/ATK/DEF/SPD`.
- Level curve: exponential XP-to-next (`base * growth^level`) for grind-y powerscaling.
- Equipment slots: weapon, armor, accessory ×2 (tune later).

### 4.3 Overworld
- Tile grid with passability + encounter-danger per biome.
- Encounter accumulator: each step adds `danger * rng jitter`; threshold → encounter, then reset.

### 4.4 Dungeon
- Per-floor grid map, stored in `dungeonState` (floor index, layout, explored mask, entities).
- Deterministic from `seed + dungeonId + floor` so a dungeon is stable within a run.

---

## 5. First-Person Dungeon Rendering (the hard part)

rot.js gives you the *map data* but only draws top-down. The FP view is custom. Two viable approaches — start simple, upgrade if needed:

**Approach A — Prebuilt depth-slice ASCII (recommended first).**
Render a fixed set of nested ASCII frames representing "wall directly ahead at distance 0/1/2/3" plus left/right wall presence. Composite them based on what the grid says is in front of the party. This is how classic blobbers fake perspective — a handful of hand-drawn ASCII templates layered by depth. Fast, deterministic, no math-heavy raycasting.

**Approach B — ASCII raycaster.**
Cast rays across a small FOV, shade walls by distance with character ramps (`█▓▒░` / `#=-.`). More flexible (varied geometry) but more work and easy to make unreadable in a terminal.

**Decision:** ship **Approach A** for the loop-lock milestone. It reads clearly, is trivially deterministic, and matches the Wizardry/Dragon Quest aesthetic. Revisit Approach B only if map variety demands it.

Include a small top-down **minimap** in a corner (rot.js can render this directly) so players don't get lost while the main panel shows the FP view.

---

## 6. Loot & "Monster-Implicit" Pools

Modeled on **Grim Dawn's Monster Infrequents**: items that drop *only* from a specific enemy type or boss, and *only occasionally*, creating targeted farming goals. ([Grim Dawn wiki / community explanation](https://www.youtube.com/watch?v=qKjEDPXcrFw))

### Drop resolution order (per kill / per chest)
1. **Base tier roll** — does anything drop? (weighted by enemy tier / chest quality)
2. **Rarity roll** — common / magic / rare / unique.
3. **Source pool select:**
   - Trash mobs → generic loot table for their tier.
   - Bosses & special enemy types → *also* roll against their **monster-implicit pool** (low chance, dedicated items).
4. **Affix generation** — assign prefix/suffix affixes appropriate to rarity and item base.

### Monster-implicit pool design
```ts
interface MonsterImplicitPool {
  sourceId: string;          // e.g. "boss_slime_king" or "type_overseer"
  dropChance: number;        // e.g. 0.08  → intentionally "infrequent"
  items: WeightedItemRef[];  // dedicated bases, often with signature affixes
}
```
- Each boss gets 1–3 signature items → gives players a reason to *re-run a specific dungeon*.
- Some pools attach to an *enemy type* (drops from any of that type across the world), some to a *unique boss* (single source) — mirror the Grim Dawn distinction.
- Signature items can carry a fixed "implicit" affix on top of rolled affixes (that's the hook — they're recognizably *that monster's* drop).

### Affix system (Diablo/Siralim-flavored)
- `ItemBase` (type, slot, base stats, level req) + `Affix[]` (rolled ranges).
- Prefixes vs suffixes; caps per rarity (e.g. rare = up to 3 prefix + 3 suffix).
- Weighted affix pools gated by item level → supports endless powerscaling later.

---

## 7. Data Definitions (author as static data early)

Keep content in `/src/data` as typed objects so designers/you can tune without touching engine code:
- `monsters.ts` — stats, tier, loot table ref, implicit pool ref.
- `itemBases.ts` — weapon/armor/accessory bases.
- `affixes.ts` — prefix/suffix pools with value ranges + ilvl gates.
- `lootTables.ts` — per-tier + per-chest weighted tables.
- `implicitPools.ts` — the monster-implicit definitions.
- `shops.ts` — village store inventory.

---

## 8. Persistence Schema (sqlite, first pass)

```
saves(id, slot, seed, gold, scene, created_at, updated_at)
party_members(id, save_id, name, class, level, xp, stats_json, hp, mp)
inventory(id, save_id, item_json, equipped_slot NULL)
world_state(save_id, discovered_json, dungeon_progress_json)
```
- Serialize the whole `GameState` to JSON columns for the milestone (simplicity), normalize later if needed.
- Save only at the **Church** (deliberate, roguelike-flavored checkpointing) — plus an autosave-on-quit safety write.

---

## 9. Testing Strategy

- **Engine unit tests (vitest):** combat math, level-up curve, loot resolution (seeded → assert exact rolls), affix ranges, save/load round-trip.
- **Determinism tests:** same seed + same inputs → identical state hash.
- **No UI snapshot tests yet** — Ink layout will churn during the milestone.
- Target: every `/engine` module has tests before it's considered "done" in a phase.

---

## 10. Risks & Open Questions

| Risk / question | Note |
|---|---|
| FP ASCII readability in terminal | Mitigated by Approach A + minimap; validate early with real terminal testing |
| Ink performance on frequent redraws | Debounce store→render; only re-render changed screen regions |
| Scope creep into "full game" | This milestone is *loop-lock only* — defer classes, skill trees, story |
| Party size (1 vs 4) | Start with **1 hero** to simplify battle; expand to party once loop is proven |
| Permadeath vs. return-to-town on death | Decide before Phase 6 balance pass |
| Real-time vs strictly turn-based overworld | Locked: turn/step-based everywhere for determinism |

---

## 11. Definition of Done (this milestone)

- [ ] Player can complete the full loop (§2) unassisted, start to save.
- [ ] Boss drops resolve a monster-implicit item at least once in a normal run.
- [ ] Save/load restores an in-progress run faithfully.
- [ ] `/engine` is UI-free and covered by deterministic tests.
- [ ] Seed is logged and reproducible.

---

*Next step after loop-lock:* content depth (classes, skill trees, more affixes/uniques, deeper dungeons) — and, if the project earns the investment, the Rust (Ratatui + bevy_ecs) port using this engine spec as the blueprint.
