/**
 * Pure rendering helpers for the first-person dungeon screen (PROJECT_PLAN
 * Phase 3, Approach A). No Ink/React import so this stays trivially
 * unit-testable; `DungeonScreen.tsx` is the thin Ink wrapper.
 *
 * `renderDungeonView` composes a classic Wizardry-style wireframe from what the
 * grid shows ahead of the party: perspective rails converge on the center,
 * vertical posts show the side walls at each depth, and the nearest wall ahead
 * is an outlined plane. The nearest interactable ahead is drawn as a glyph at
 * the vanishing point. The wireframe geometry is composed as line segments in a
 * canonical 39x13 space, then rasterized onto a Braille dot canvas
 * ({@link ./braille}) for smooth diagonals; the dot resolution scales with the
 * viewport so the frame stays crisp as it reflows to the terminal.
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
import { createDotCanvas, packBraille, plotLine } from "./braille";

export const FP_VIEW_WIDTH = 39;
export const FP_VIEW_HEIGHT = 13;

export const MINIMAP_WIDTH = 17;
export const MINIMAP_HEIGHT = 9;

/** Integer viewport dimensions the FP view is scaled/centered into. */
export interface Viewport {
  width: number;
  height: number;
}

interface Portal {
  l: number;
  r: number;
  t: number;
  b: number;
}

// The near edge, four visible depths, and the vanishing point.
const PORTALS: readonly Portal[] = [
  { l: 1, r: 37, t: 0, b: 12 },
  { l: 8, r: 30, t: 1, b: 11 },
  { l: 12, r: 26, t: 2, b: 10 },
  { l: 15, r: 23, t: 3, b: 9 },
  { l: 17, r: 21, t: 4, b: 8 },
  { l: 18, r: 20, t: 5, b: 7 },
];
const VISIBLE_DEPTH = PORTALS.length - 2;

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

/** A wireframe line in canonical 39x13 coordinates. */
interface Segment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A feature glyph placed at a canonical cell. */
interface GlyphAt {
  x: number;
  y: number;
  char: string;
}

function post(x: number, top: number, bottom: number): Segment {
  return { x0: x, y0: top, x1: x, y1: bottom };
}

/**
 * Project a lateral offset (in tiles, left negative / right positive from the
 * party's column) onto canonical screen-x at depth `plane`. Every portal is
 * centered on {@link CENTER_X}, and its full width `r - l` is exactly one tile
 * of lateral span at that depth, so a wall `L` tiles to the side lands at
 * `CENTER_X + L * (r - l)` - off-screen up close, sweeping into view with depth.
 */
function proj(lateral: number, plane: number): number {
  const p = PORTALS[plane];
  return CENTER_X + lateral * (p.r - p.l);
}

/**
 * One continuous side wall at constant lateral offset `lat`, running from depth
 * plane `dFrom` to plane `dTo + 1`: the ceiling and floor rails receding through
 * every portal it spans (so it stays smooth through the hand-tuned perspective)
 * plus the two end jambs. Drawn as one surface, not per-cell, so a straight wall
 * reads as a single receding plane rather than a stack of crossing panels.
 */
function sideWallPlane(lat: number, dFrom: number, dTo: number): Segment[] {
  const segments: Segment[] = [];
  for (let d = dFrom; d <= dTo; d++) {
    const nearX = proj(lat, d);
    const farX = proj(lat, d + 1);
    const n = PORTALS[d];
    const f = PORTALS[d + 1];
    segments.push(
      { x0: nearX, y0: n.t, x1: farX, y1: f.t },
      { x0: nearX, y0: n.b, x1: farX, y1: f.b },
    );
  }
  const near = PORTALS[dFrom];
  const far = PORTALS[dTo + 1];
  segments.push(
    post(proj(lat, dFrom), near.t, near.b),
    post(proj(lat, dTo + 1), far.t, far.b),
  );
  return segments;
}

/** The wall closing the far end of the room, framed to its width at plane `d`. */
function backWall(leftLat: number, rightLat: number, d: number): Segment[] {
  const xl = proj(leftLat, d);
  const xr = proj(rightLat, d);
  const p = PORTALS[d];
  return [
    { x0: xl, y0: p.t, x1: xr, y1: p.t },
    { x0: xl, y0: p.b, x1: xr, y1: p.b },
    post(xl, p.t, p.b),
    post(xr, p.t, p.b),
  ];
}

/**
 * The far floor edge: one horizontal line where the floor meets the far end of
 * the visible space (plane `d`), spanning lateral `latL`..`latR`. A minimal
 * ground cue so an open room reads as a floored space receding to a back edge
 * rather than a void, without a full (illegible) grid.
 */
function floorLine(latL: number, latR: number, d: number): Segment {
  const b = PORTALS[d].b;
  return { x0: proj(latL, d), y0: b, x1: proj(latR, d), y1: b };
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

/** Furthest lateral scan (tiles) before a side wall is treated as out of view. */
const LATERAL_LIMIT = 8;

/**
 * Open floor tiles between `cell` and the first wall in perpendicular direction
 * `side` (0 = wall is immediately adjacent). Capped at {@link LATERAL_LIMIT} so
 * a wide-open flank projects off-screen rather than scanning the whole map.
 */
function openRun(ds: DungeonState, cell: Point, side: DungeonFacing): number {
  const delta = forwardDelta(side);
  let n = 0;
  let p = { x: cell.x + delta.x, y: cell.y + delta.y };
  while (n < LATERAL_LIMIT && !wallAhead(ds, p)) {
    n++;
    p = { x: p.x + delta.x, y: p.y + delta.y };
  }
  return n;
}

/** Nearest interactable glyph directly ahead within the visible corridor. */
function nearestFeatureGlyph(
  ds: DungeonState,
  facing: DungeonFacing,
  dBack: number,
): string | null {
  const limit = Math.min(dBack - 1, VISIBLE_DEPTH);
  for (let d = 1; d <= limit; d++) {
    const feature = tileFeature(ds.layout, aheadCell(ds.player, facing, d));
    if (feature !== "none") return FEATURE_GLYPH[feature];
  }
  return null;
}

/**
 * Compose the first-person wireframe as line segments in canonical 39x13
 * coordinates plus an optional feature glyph. Geometry only - the rasterizer
 * turns this into Braille at whatever resolution the viewport calls for.
 */
function composeGeometry(ds: DungeonState): {
  segments: Segment[];
  glyph: GlyphAt | null;
} {
  const facing = ds.facing;
  const left = rotateFacing(facing, "left");
  const right = rotateFacing(facing, "right");

  // Distance to the nearest wall ahead, or one past the visible range.
  let dBack = VISIBLE_DEPTH + 1;
  for (let d = 1; d <= VISIBLE_DEPTH; d++) {
    if (wallAhead(ds, aheadCell(ds.player, facing, d))) {
      dBack = d;
      break;
    }
  }

  // Each side wall is measured once at the party (how many open tiles to the
  // nearest wall) and drawn as one straight plane, extended back only while the
  // wall stays that same distance away. This keeps rooms coherent: a rectangular
  // room reads as a box, and a wall that opens up ends the plane there (a side
  // passage) instead of spraying a fresh panel at every depth.
  const lastCell = Math.min(dBack - 1, VISIBLE_DEPTH);
  const segments: Segment[] = [
    floorLine(
      -(openRun(ds, ds.player, left) + 0.5),
      openRun(ds, ds.player, right) + 0.5,
      Math.min(dBack, VISIBLE_DEPTH + 1),
    ),
  ];

  for (const [side, sign] of [
    [left, -1],
    [right, 1],
  ] as const) {
    const run = openRun(ds, ds.player, side);
    if (run >= LATERAL_LIMIT) continue; // no wall in view on this flank
    let dTo = 0;
    while (
      dTo < lastCell &&
      openRun(ds, aheadCell(ds.player, facing, dTo + 1), side) === run
    ) {
      dTo++;
    }
    segments.push(...sideWallPlane(sign * (run + 0.5), 0, dTo));
  }

  if (dBack <= VISIBLE_DEPTH) {
    // Frame the far wall to the room's width one cell short of it.
    const lastOpen = aheadCell(ds.player, facing, lastCell);
    segments.push(
      ...backWall(
        -(openRun(ds, lastOpen, left) + 0.5),
        openRun(ds, lastOpen, right) + 0.5,
        dBack,
      ),
    );
  }

  const feature = nearestFeatureGlyph(ds, facing, dBack);
  const glyph = feature ? { x: CENTER_X, y: CENTER_Y, char: feature } : null;
  return { segments, glyph };
}

/**
 * Rasterize canonical wireframe segments onto a Braille dot canvas sized for a
 * `cols` x `rows` character grid (2x4 dots per cell), overlaying the feature
 * glyph as a plain char. Returns `rows` strings of exactly `cols` columns.
 */
function rasterize(
  segments: Segment[],
  glyph: GlyphAt | null,
  cols: number,
  rows: number,
): string[] {
  const dotW = cols * 2;
  const dotH = rows * 4;
  // Map canonical corner indices (0..W-1) exactly onto the dot-canvas edges so
  // the wireframe stays centered at every scale.
  const scaleX = (dotW - 1) / (FP_VIEW_WIDTH - 1);
  const scaleY = (dotH - 1) / (FP_VIEW_HEIGHT - 1);
  const buf = createDotCanvas(dotW, dotH);
  for (const s of segments) {
    plotLine(
      buf,
      dotW,
      dotH,
      s.x0 * scaleX,
      s.y0 * scaleY,
      s.x1 * scaleX,
      s.y1 * scaleY,
    );
  }

  const grid = packBraille(buf, dotW, dotH);
  if (glyph) {
    const gc = clamp(
      Math.round((glyph.x * (cols - 1)) / (FP_VIEW_WIDTH - 1)),
      0,
      cols - 1,
    );
    const gr = clamp(
      Math.round((glyph.y * (rows - 1)) / (FP_VIEW_HEIGHT - 1)),
      0,
      rows - 1,
    );
    grid[gr] = grid[gr].slice(0, gc) + glyph.char + grid[gr].slice(gc + 1);
  }
  return grid;
}

/** Center a `cols`x`rows` grid inside `viewport`, padding with spaces. */
function centerInViewport(
  grid: string[],
  cols: number,
  rows: number,
  viewport: Viewport,
): string[] {
  const offsetX = Math.floor((viewport.width - cols) / 2);
  const offsetY = Math.floor((viewport.height - rows) / 2);
  const blank = " ".repeat(viewport.width);
  const out: string[] = [];
  for (let y = 0; y < viewport.height; y++) {
    const line = grid[y - offsetY];
    if (line === undefined) {
      out.push(blank);
      continue;
    }
    out.push(
      " ".repeat(offsetX) + line + " ".repeat(viewport.width - offsetX - cols),
    );
  }
  return out;
}

/**
 * Compose the first-person depth-slice view as Braille. Without a viewport this
 * returns the canonical {@link FP_VIEW_WIDTH}x{@link FP_VIEW_HEIGHT} view; with
 * one, the wireframe is rasterized at a proportionally larger dot resolution
 * and centered so it reflows to the terminal while staying crisp.
 */
export function renderDungeonView(
  ds: DungeonState,
  viewport?: Viewport,
): string[] {
  const { segments, glyph } = composeGeometry(ds);
  if (!viewport) {
    return rasterize(segments, glyph, FP_VIEW_WIDTH, FP_VIEW_HEIGHT);
  }
  const scale = Math.min(
    viewport.width / FP_VIEW_WIDTH,
    viewport.height / FP_VIEW_HEIGHT,
  );
  const cols = Math.max(1, Math.floor(FP_VIEW_WIDTH * scale));
  const rows = Math.max(1, Math.floor(FP_VIEW_HEIGHT * scale));
  return centerInViewport(
    rasterize(segments, glyph, cols, rows),
    cols,
    rows,
    viewport,
  );
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
