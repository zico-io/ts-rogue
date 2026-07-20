/** A single tile coordinate on the overworld or dungeon grid. */
export interface Point {
  x: number;
  y: number;
}

/**
 * Overworld biome tiles (PROJECT_PLAN Phase 2). `mountain` and `water` are
 * impassable; everything else can be walked onto. `village` and
 * `dungeonEntrance` are special waypoint tiles that trigger a scene change
 * instead of accumulating encounter danger.
 */
export type Tile =
  | "grass"
  | "forest"
  | "mountain"
  | "water"
  | "village"
  | "dungeonEntrance";

/**
 * A generated overworld. Deterministic and fully derived from a single
 * numeric seed (see {@link generateOverworldMap}), so it is never stored on
 * `GameState` itself - only the seed is. `tiles` is row-major: `tiles[y][x]`.
 */
export interface OverworldMap {
  width: number;
  height: number;
  tiles: readonly (readonly Tile[])[];
  village: Point;
  dungeonEntrances: readonly Point[];
}

/** The mutable slice of `GameState` that tracks progress on the overworld. */
export interface WorldState {
  player: Point;
  encounterMeter: number;
}

/**
 * Cardinal facing for first-person dungeon movement (PROJECT_PLAN Phase 3).
 * The party rotates in 90-degree increments and steps along its facing.
 */
export type DungeonFacing = "north" | "east" | "south" | "west";

/**
 * Interactable feature placed on a dungeon floor tile (PROJECT_PLAN Phase 3).
 * `none` is plain floor; the others are tiles the player interacts with:
 * `chest` (loot), `stairsDown` (descend a floor), `bossMarker` (the floor's
 * boss room - triggers a fixed encounter).
 */
export type DungeonFeature = "none" | "chest" | "stairsDown" | "bossMarker";

/**
 * A single dungeon grid cell. `wall` cells are impassable; floor cells may
 * carry a {@link DungeonFeature}. Row-major: `tiles[y][x]`.
 */
export interface DungeonTile {
  wall: boolean;
  feature: DungeonFeature;
}

/**
 * A generated dungeon floor. Deterministic from `seed + dungeonId + floor`
 * (see `generateDungeonLayout` in `world/dungeon.ts`). Unlike the overworld
 * map, a floor layout IS stored on `GameState.dungeonState` so the explored
 * mask and opened chests stay consistent with the grid across save/load.
 */
export interface DungeonLayout {
  width: number;
  height: number;
  tiles: readonly (readonly DungeonTile[])[];
  entrance: Point;
}

/**
 * A pending dungeon encounter flagged by a trigger (PROJECT_PLAN Phase 3).
 * Phase 4 (turn-based battle) resolves these for real; for now flagging one
 * switches `scene` to `battle` as a stub transition.
 */
export interface DungeonEncounter {
  kind: "wandering" | "boss";
  floor: number;
}

/**
 * The mutable slice of `GameState` that tracks a dungeon run. A single
 * serializable tree: layout + explored mask + player position/facing +
 * encounter flag + boss-reached flag. `null` until the party enters a
 * dungeon entrance on the overworld.
 */
export interface DungeonState {
  dungeonId: string;
  floor: number;
  layout: DungeonLayout;
  player: Point;
  facing: DungeonFacing;
  explored: readonly (readonly boolean[])[];
  encounter: DungeonEncounter | null;
  reachedBoss: boolean;
}
