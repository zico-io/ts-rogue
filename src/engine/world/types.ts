export interface Point {
  x: number;
  y: number;
}

export type Tile =
  | "grass"
  | "forest"
  | "mountain"
  | "water"
  | "village"
  | "dungeonEntrance";

export interface OverworldMap {
  width: number;
  height: number;
  tiles: readonly (readonly Tile[])[];
  village: Point;
  dungeonEntrances: readonly Point[];
}

export interface WorldState {
  player: Point;
  encounterMeter: number;
}

export type DungeonFacing = "north" | "east" | "south" | "west";

export type DungeonFeature = "none" | "chest" | "stairsDown" | "bossMarker";

export interface DungeonTile {
  wall: boolean;
  feature: DungeonFeature;
}

export interface DungeonLayout {
  width: number;
  height: number;
  tiles: readonly (readonly DungeonTile[])[];
  entrance: Point;
}

export interface DungeonEncounter {
  kind: "wandering" | "boss";
  floor: number;
}

export interface DungeonState {
  dungeonId: string;

  // The active DungeonDef's theme id (src/data/dungeons.ts), threaded through
  // as plain data so src/ui can drive per-theme accents without importing
  // engine behavior (ROG-94).
  theme: string;
  floor: number;
  layout: DungeonLayout;
  player: Point;
  facing: DungeonFacing;
  explored: readonly (readonly boolean[])[];
  encounter: DungeonEncounter | null;
  reachedBoss: boolean;
  cleared: boolean;
}
