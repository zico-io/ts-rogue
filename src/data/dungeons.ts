import { findShopItem } from "./shops";

export interface ChestLoot {
  gold: number;
  itemId: string | null;
  quantity: number;
}

export function chestLootFor(
  dungeonId: string,
  floor: number,
  x: number,
  y: number,
): ChestLoot {
  const dungeonHash = dungeonId.charCodeAt(0) + dungeonId.length;
  const gold = 20 + ((x * 7 + y * 13 + floor * 5 + dungeonHash) % 40);
  return { gold, itemId: "potion", quantity: 1 };
}

export function chestLootMessage(loot: ChestLoot): string {
  const item = loot.itemId ? findShopItem(loot.itemId) : undefined;
  const itemPart = item ? ` and ${loot.quantity} ${item.name}` : "";
  return `You open the chest and find ${loot.gold} gold${itemPart}!`;
}

// A wandering-encounter weight for a monster id from src/data/monsters.ts.
// Excludes the dungeon's boss, which spawns separately from bossId.
export interface DungeonPaletteEntry {
  monsterId: string;
  weight: number;
}

// Loot-table ref (see src/data/lootTables.ts) for a contiguous run of floors,
// so deeper bands within a dungeon can point at richer tables.
export interface DungeonFloorBand {
  minFloor: number;
  maxFloor: number;
  lootTableRef: string;
}

export interface DungeonDef {
  id: string;
  name: string;
  theme: string;
  tier: number;
  floorCount: number;
  palette: readonly DungeonPaletteEntry[];
  bossId: string;
  floorBands: readonly DungeonFloorBand[];
  recommendedLevel: number;
  story: true;
}

// Placeholder palettes drawn from the current monster roster (src/data/monsters.ts).
// The bestiary expansion (ROG-30) will give each dungeon a distinct cast.
export const DUNGEONS: readonly DungeonDef[] = [
  {
    id: "sunken-crypt",
    name: "Sunken Crypt",
    theme: "crypt",
    tier: 1,
    floorCount: 3,
    palette: [
      { monsterId: "slime", weight: 3 },
      { monsterId: "goblin", weight: 1 },
    ],
    bossId: "dungeon-guardian",
    floorBands: [
      { minFloor: 1, maxFloor: 2, lootTableRef: "tier-1" },
      { minFloor: 3, maxFloor: 3, lootTableRef: "tier-2" },
    ],
    recommendedLevel: 1,
    story: true,
  },
  {
    id: "howling-cave",
    name: "Howling Cave",
    theme: "cave",
    tier: 2,
    floorCount: 4,
    palette: [
      { monsterId: "goblin", weight: 3 },
      { monsterId: "slime", weight: 1 },
    ],
    bossId: "dungeon-guardian",
    floorBands: [
      { minFloor: 1, maxFloor: 2, lootTableRef: "tier-2" },
      { minFloor: 3, maxFloor: 4, lootTableRef: "tier-3" },
    ],
    recommendedLevel: 5,
    story: true,
  },
  {
    id: "forgotten-ruins",
    name: "Forgotten Ruins",
    theme: "ruins",
    tier: 3,
    floorCount: 5,
    palette: [{ monsterId: "goblin", weight: 1 }],
    bossId: "dungeon-guardian",
    floorBands: [
      { minFloor: 1, maxFloor: 3, lootTableRef: "tier-2" },
      { minFloor: 4, maxFloor: 5, lootTableRef: "tier-3" },
    ],
    recommendedLevel: 10,
    story: true,
  },
];

export function findDungeon(id: string): DungeonDef | undefined {
  return DUNGEONS.find((dungeon) => dungeon.id === id);
}

// Resolves the def driving a live dungeon run. Falls back to the first story
// def for a dungeonId that doesn't match one yet -- e.g. the placeholder
// `dungeon-<entranceIndex>` ids overworld generation assigns until ROG-90
// wires real entrance-to-dungeon assignment.
export function dungeonDefFor(dungeonId: string): DungeonDef {
  return findDungeon(dungeonId) ?? DUNGEONS[0];
}
