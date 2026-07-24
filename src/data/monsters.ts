/**
 * Monster definitions (PROJECT_PLAN Phase 4, ROG-10; Phase 5, ROG-11; data
 * table named in section 7).
 *
 * Each monster is plain serializable data: base stats, HP/MP, XP/gold reward,
 * a difficulty tier, first-person ASCII art drawn facing the viewer
 * (Wizardry/Dragon Quest style - the party sees the monster looking back at
 * them), and Phase 5 loot hooks: a `lootTableRef` selecting the weighted loot
 * table rolled on victory, and an optional `implicitPoolRef` for the
 * monster-implicit pool (bosses and certain enemy types). Phase 5 battles read
 * these via the loot resolution helper in `src/engine/loot/resolution.ts`.
 *
 * Phase 6 (ROG-12) balance pass: trash mob gold was raised slightly so the
 * early game is less grindy. Slime gold 3 -> 5; Goblin gold 8 -> 12. The boss
 * gold (120) and all XP values are unchanged; the XP curve already produces a
 * satisfying few levels over a 20-30 min session.
 *
 * ROG-44: monsters with a browser battle sprite carry an optional `sprite`
 * atlas frame id alongside `ascii`; the terminal renderer keeps using `ascii`
 * unchanged.
 */

export interface MonsterStats {
  str: number;
  agi: number;
  vit: number;
  int: number;
}

export interface MonsterDef {
  id: string;
  name: string;
  stats: MonsterStats;
  maxHp: number;
  maxMp: number;
  xp: number;
  gold: number;
  /** Lowest dungeon floor this monster appears on (wandering or boss). */
  minFloor: number;
  /** Difficulty tier; Phase 5 loot tables and implicit pools key off this. */
  tier: number;
  /** Weighted loot table rolled on victory (see `src/data/lootTables.ts`). */
  lootTableRef: string;
  /** Optional monster-implicit pool (see `src/data/implicitPools.ts`). */
  implicitPoolRef?: string;
  /** First-person ASCII art, line by line, facing the viewer. */
  ascii: readonly string[];
  /** Accent color (hex) tinting this monster's battle art (ROG-31). */
  color: string;
  /**
   * Browser sprite id (ROG-44): a frame name in the Pixi atlas built by
   * `scripts/build-atlas.ts` (`src/web/atlas.ts` loads it, `src/web/main.ts`
   * looks sprites up by this id). Additive - optional so terminal saves and
   * the terminal renderer, which keeps using `ascii`, are unaffected.
   */
  sprite?: string;
}

export const MONSTERS: readonly MonsterDef[] = [
  {
    id: "slime",
    name: "Slime",
    stats: { str: 4, agi: 3, vit: 4, int: 1 },
    maxHp: 12,
    maxMp: 0,
    xp: 5,
    gold: 5,
    minFloor: 1,
    tier: 1,
    lootTableRef: "tier-1",
    implicitPoolRef: "type_slime",
    sprite: "slime",
    ascii: [
      "       .-~~~-.",
      "   .-~~       ~~-.",
      "  /   (o)   (o)   \\",
      " |                 |",
      " |   \\.       ./   |",
      "  \\    ~-.-.-~    /",
      "   ~-.________.-~",
    ],
    color: "#53c09f",
  },
  {
    id: "goblin",
    name: "Goblin",
    stats: { str: 7, agi: 6, vit: 4, int: 3 },
    maxHp: 22,
    maxMp: 0,
    xp: 12,
    gold: 12,
    minFloor: 2,
    tier: 2,
    lootTableRef: "tier-2",
    sprite: "goblin",
    ascii: [
      "     /\\      /\\",
      "    /  \\.--./  \\",
      "    | (o)  (o) |",
      "    |    __    |",
      "    \\   \\__/   /",
      "     |~~~~~~~~|",
      "    /|  |__|  |\\",
      "   / |__|  |__| \\",
      "     (__)  (__)",
    ],
    color: "#5fae3b",
  },
  {
    id: "dungeon-guardian",
    name: "Dungeon Guardian",
    stats: { str: 12, agi: 5, vit: 14, int: 2 },
    maxHp: 60,
    maxMp: 0,
    xp: 80,
    gold: 120,
    minFloor: 3,
    tier: 3,
    lootTableRef: "tier-3",
    implicitPoolRef: "boss_dungeon_guardian",
    sprite: "dungeon-guardian",
    ascii: [
      "       ______",
      "      /|====|\\",
      "     | |[][]| |",
      "      \\|====|/",
      "    .--|    |--.",
      "   /   |----|   \\",
      "  |  / |    | \\  |",
      "  | |  |    |  | |",
      "  |_|  |----|  |_|",
      "       |    |",
      "      _|____|_",
    ],
    color: "#e74343",
  },
];

export function findMonster(id: string): MonsterDef | undefined {
  return MONSTERS.find((monster) => monster.id === id);
}
