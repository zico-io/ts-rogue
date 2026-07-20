/** A single tile coordinate on the overworld grid. */
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
