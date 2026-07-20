/**
 * Pure rendering helpers for the first-person dungeon screen (PROJECT_PLAN
 * Phase 3, Approach A). No Ink/React import so this stays trivially
 * unit-testable; `DungeonScreen.tsx` is the thin Ink wrapper.
 *
 * `renderDungeonView` composes a fixed set of nested ASCII depth-slice frames
 * from what the grid shows ahead of the party: for each distance 1-4 it draws
 * a corridor frame whose left/right edges reflect wall presence on that slice,
 * and fills the nearest wall ahead as a solid back wall. The nearest
 * interactable ahead is drawn as a glyph at the vanishing point.
 * `renderMinimap` draws a windowed top-down corner map using the explored mask.
 */

import {
  forwardDelta,
  inDungeonBounds,
  isDungeonWall,
  rotateFacing,
  tileFeature,
} from "../../../engine/world/dungeon";
import type {
  DungeonFacing,
  DungeonFeature,
  DungeonState,
  Point,
} from "../../../engine/world/types";

export const FP_VIEW_WIDTH = 39;
export const FP_VIEW_HEIGHT = 13;

export const MINIMAP_WIDTH = 17;
export const MINIMAP_HEIGHT = 9;

interface Frame {
  l: number;
  r: number;
  t: number;
  b: number;
}

// d=1 (nearest, largest) .. d=4 (farthest, smallest), concentric about (19,6).
const FRAMES: readonly Frame[] = [
  { l: 8, r: 30, t: 1, b: 11 },
  { l: 11, r: 27, t: 2, b: 10 },
  { l: 14, r: 24, t: 3, b: 9 },
  { l: 17, r: 21, t: 4, b: 8 },
];

const CENTER_X = 19;
const CENTER_Y = 6;

const FEATURE_GLYPH: Record<Exclude<DungeonFeature, "none">, string> = {
  chest: "C",
  stairsDown: ">",
  bossMarker: "B",
};

export const FACING_GLYPH: Record<DungeonFacing, string> = {
  north: "^",
  east: ">",
  south: "v",
  west: "<",
};

function blankGrid(): string[][] {
  return Array.from({ length: FP_VIEW_HEIGHT }, () =>
    Array.from({ length: FP_VIEW_WIDTH }, () => " "),
  );
}

function drawFrame(
  grid: string[][],
  frame: Frame,
  leftWall: boolean,
  rightWall: boolean,
): void {
  grid[frame.t][frame.l] = "+";
  grid[frame.t][frame.r] = "+";
  grid[frame.b][frame.l] = "+";
  grid[frame.b][frame.r] = "+";
  for (let x = frame.l + 1; x < frame.r; x++) {
    grid[frame.t][x] = "-";
    grid[frame.b][x] = "-";
  }
  for (let y = frame.t + 1; y < frame.b; y++) {
    grid[y][frame.l] = leftWall ? "|" : " ";
    grid[y][frame.r] = rightWall ? "|" : " ";
  }
}

function fillRect(grid: string[][], frame: Frame, ch: string): void {
  for (let y = frame.t; y <= frame.b; y++) {
    for (let x = frame.l; x <= frame.r; x++) {
      grid[y][x] = ch;
    }
  }
}

function aheadCell(
  player: Point,
  facing: DungeonFacing,
  distance: number,
): Point {
  const delta = forwardDelta(facing);
  return { x: player.x + delta.x * distance, y: player.y + delta.y * distance };
}

function wallAhead(ds: DungeonState, cell: Point): boolean {
  return !inDungeonBounds(ds.layout, cell) || isDungeonWall(ds.layout, cell);
}

function sideWall(
  ds: DungeonState,
  ahead: Point,
  side: DungeonFacing,
): boolean {
  const delta = forwardDelta(side);
  return wallAhead(ds, { x: ahead.x + delta.x, y: ahead.y + delta.y });
}

/** Nearest interactable glyph directly ahead within the visible corridor. */
function nearestFeatureGlyph(
  ds: DungeonState,
  facing: DungeonFacing,
  dBack: number,
): string | null {
  const limit = Math.min(dBack - 1, FRAMES.length);
  for (let d = 1; d <= limit; d++) {
    const feature = tileFeature(ds.layout, aheadCell(ds.player, facing, d));
    if (feature !== "none") return FEATURE_GLYPH[feature];
  }
  return null;
}

/**
 * Compose the first-person depth-slice view. Returns one string per render
 * row, each exactly {@link FP_VIEW_WIDTH} columns wide.
 */
export function renderDungeonView(ds: DungeonState): string[] {
  const grid = blankGrid();
  const facing = ds.facing;
  const left = rotateFacing(facing, "left");
  const right = rotateFacing(facing, "right");

  // Distance to the nearest wall ahead (1..4), or 5 if the way is open past view.
  let dBack = FRAMES.length + 1;
  for (let d = 1; d <= FRAMES.length; d++) {
    if (wallAhead(ds, aheadCell(ds.player, facing, d))) {
      dBack = d;
      break;
    }
  }

  const lastCorridor = Math.min(dBack - 1, FRAMES.length);
  for (let d = 1; d <= lastCorridor; d++) {
    const ahead = aheadCell(ds.player, facing, d);
    drawFrame(
      grid,
      FRAMES[d - 1],
      sideWall(ds, ahead, left),
      sideWall(ds, ahead, right),
    );
  }

  if (dBack <= FRAMES.length) {
    fillRect(grid, FRAMES[dBack - 1], "#");
  }

  const glyph = nearestFeatureGlyph(ds, facing, dBack);
  if (glyph) grid[CENTER_Y][CENTER_X] = glyph;

  return grid.map((row) => row.join(""));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/**
 * Windowed top-down minimap centered on the party. Explored tiles show walls
 * as `#`, floor as `.`, and features by glyph; unexplored tiles are blank.
 * The party is drawn as its facing arrow. Returns one string per render row.
 */
export function renderMinimap(ds: DungeonState): string[] {
  const layout = ds.layout;
  const halfWidth = Math.floor(MINIMAP_WIDTH / 2);
  const halfHeight = Math.floor(MINIMAP_HEIGHT / 2);
  const ox = clamp(
    ds.player.x - halfWidth,
    0,
    Math.max(0, layout.width - MINIMAP_WIDTH),
  );
  const oy = clamp(
    ds.player.y - halfHeight,
    0,
    Math.max(0, layout.height - MINIMAP_HEIGHT),
  );
  const rows: string[] = [];
  for (let my = 0; my < MINIMAP_HEIGHT; my++) {
    let row = "";
    for (let mx = 0; mx < MINIMAP_WIDTH; mx++) {
      const x = ox + mx;
      const y = oy + my;
      if (x === ds.player.x && y === ds.player.y) {
        row += FACING_GLYPH[ds.facing];
        continue;
      }
      const seen = ds.explored[y]?.[x] === true;
      if (!seen) {
        row += " ";
        continue;
      }
      const tile = layout.tiles[y]?.[x];
      if (!tile || tile.wall) row += "#";
      else if (tile.feature === "chest") row += "C";
      else if (tile.feature === "stairsDown") row += ">";
      else if (tile.feature === "bossMarker") row += "B";
      else row += ".";
    }
    rows.push(row);
  }
  return rows;
}
