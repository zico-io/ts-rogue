import type { Point, Tile } from "./types";

export interface Footprint {
  readonly width: number;
  readonly height: number;
}

export type LandmarkTile = "village" | "dungeonEntrance";

/**
 * Footprint size (in tiles) for each landmark kind. A landmark's occupied
 * cells are always derived from its anchor point (the top-left corner) plus
 * this size lookup - the footprint itself is never stored per-cell.
 */
export const LANDMARK_FOOTPRINTS: Record<LandmarkTile, Footprint> = {
  village: { width: 2, height: 2 },
  dungeonEntrance: { width: 1, height: 1 },
};

/** Every tile covered by a landmark's footprint, anchored at its top-left cell. */
export function footprintCells(anchor: Point, footprint: Footprint): Point[] {
  const cells: Point[] = [];
  for (let dy = 0; dy < footprint.height; dy++) {
    for (let dx = 0; dx < footprint.width; dx++) {
      cells.push({ x: anchor.x + dx, y: anchor.y + dy });
    }
  }
  return cells;
}

export function footprintFitsBounds(
  anchor: Point,
  footprint: Footprint,
  width: number,
  height: number,
): boolean {
  return (
    anchor.x >= 0 &&
    anchor.y >= 0 &&
    anchor.x + footprint.width <= width &&
    anchor.y + footprint.height <= height
  );
}

/**
 * True when every cell of the footprint is in bounds, passable, and not
 * already occupied by another landmark - i.e. it is safe to paint.
 */
export function footprintIsClear(
  tiles: readonly (readonly Tile[])[],
  anchor: Point,
  footprint: Footprint,
  isPassable: (tile: Tile) => boolean,
): boolean {
  const height = tiles.length;
  const width = tiles[0]?.length ?? 0;
  if (!footprintFitsBounds(anchor, footprint, width, height)) return false;
  return footprintCells(anchor, footprint).every((cell) => {
    const tile = tiles[cell.y][cell.x];
    return isPassable(tile) && tile !== "village" && tile !== "dungeonEntrance";
  });
}

/** Paints every cell of the footprint with the given tile in place. */
export function paintFootprint(
  tiles: Tile[][],
  anchor: Point,
  footprint: Footprint,
  tile: Tile,
): void {
  for (const cell of footprintCells(anchor, footprint)) {
    tiles[cell.y][cell.x] = tile;
  }
}
