/**
 * Pure rendering helpers for the first-person dungeon screen. No Ink/React
 * import so this stays trivially unit-testable; `DungeonScreen.tsx` is the
 * thin Ink wrapper.
 *
 * `renderDungeonView` is a perspective wall-face renderer in the classic grid
 * crawler mold: every wall cell contributes up to four vertical unit quads
 * (its exterior faces), which are backface-culled, near-clipped, perspective
 * projected, and painted far-to-near onto a Braille dot canvas
 * ({@link ./braille}) at the viewport's native dot resolution. Nearer faces
 * overwrite farther ones, so occlusion falls out of the paint order. The
 * camera is a continuous pose (position + yaw), so fractional positions and
 * angles - mid-step and mid-turn animation frames - render with the same code
 * path as the four cardinal facings.
 * `renderMinimap` draws a windowed top-down corner map using the explored mask.
 */

import { isDungeonWall, tileFeature } from "../../../engine/world/dungeon";
import type {
  DungeonFacing,
  DungeonFeature,
  DungeonState,
} from "../../../engine/world/types";
import {
  type BrailleRun,
  createDotCanvas,
  packBraille,
  packBrailleRuns,
  plotLine,
} from "./braille";

export const MINIMAP_WIDTH = 17;
export const MINIMAP_HEIGHT = 9;

/** Integer character-cell dimensions the FP view renders into. */
export interface Viewport {
  width: number;
  height: number;
}

/** Continuous camera pose in world tile coordinates; angle in radians. */
export interface CameraPose {
  x: number;
  y: number;
  angle: number;
}

/** North is 0; angles grow clockwise (grid y grows south). */
const FACING_ANGLE: Record<DungeonFacing, number> = {
  north: 0,
  east: Math.PI / 2,
  south: Math.PI,
  west: (3 * Math.PI) / 2,
};

export const FACING_GLYPH: Record<DungeonFacing, string> = {
  north: "^",
  east: ">",
  south: "v",
  west: "<",
};

/** The camera pose for the party's discrete cell + facing. */
export function poseFromState(ds: DungeonState): CameraPose {
  return { x: ds.player.x, y: ds.player.y, angle: FACING_ANGLE[ds.facing] };
}

const TAU = 2 * Math.PI;

/** Interpolate poses; the angle takes the shortest arc (handles 2π wrap). */
export function lerpPose(a: CameraPose, b: CameraPose, t: number): CameraPose {
  const arc = ((((b.angle - a.angle) % TAU) + TAU + Math.PI) % TAU) - Math.PI;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    angle: a.angle + arc * t,
  };
}

/** Depth of the near clip plane, world tiles in front of the eye. */
const Z_NEAR = 0.05;
/** Furthest visible depth in world tiles; beyond this is darkness. */
const MAX_DEPTH = 6.5;
/** Chebyshev cell radius scanned around the camera for candidate faces. */
const RANGE = 7;

/**
 * The four exterior faces of a wall cell: outward normal `(nx, ny)` and the
 * run direction `(rx, ry)` along the face. The face is the vertical unit quad
 * over the ground segment `faceCenter ± 0.5 * run`, spanning eye-relative
 * heights -0.5 (floor) to +0.5 (ceiling).
 */
const FACE_DIRS = [
  { nx: 0, ny: -1, rx: 1, ry: 0 }, // north face
  { nx: 0, ny: 1, rx: 1, ry: 0 }, // south face
  { nx: -1, ny: 0, rx: 0, ry: 1 }, // west face
  { nx: 1, ny: 0, rx: 0, ry: 1 }, // east face
] as const;

/** One projected vertical face edge: screen x plus wall top/bottom y. */
interface Edge {
  sx: number;
  syT: number;
  syB: number;
}

/** A projected wall face queued for the painter pass. */
interface FaceItem {
  kind: "face";
  distSq: number;
  e0: Edge;
  e1: Edge;
  jamb0: boolean;
  jamb1: boolean;
  density: number;
  /** Depth band 1 (far) .. 4 (near); stored in the dot buffer for coloring. */
  band: number;
}

/** A feature prop's projected wireframe segments, painter-sorted with faces. */
interface PropItem {
  kind: "prop";
  distSq: number;
  band: number;
  lines: Array<{ x0: number; y0: number; x1: number; y1: number }>;
}

type DrawItem = FaceItem | PropItem;

/**
 * A prop model segment in cell-local 3D coordinates: `[east offset, height
 * above eye, south offset]` from the cell center; the floor is at height -0.5.
 */
type Seg3 = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
];

/** The 12 wireframe edges of an axis-aligned box. */
function boxEdges(
  x0: number,
  x1: number,
  h0: number,
  h1: number,
  z0: number,
  z1: number,
): Seg3[] {
  const edges: Seg3[] = [];
  for (const h of [h0, h1]) {
    edges.push(
      [
        [x0, h, z0],
        [x1, h, z0],
      ],
      [
        [x0, h, z1],
        [x1, h, z1],
      ],
      [
        [x0, h, z0],
        [x0, h, z1],
      ],
      [
        [x1, h, z0],
        [x1, h, z1],
      ],
    );
  }
  for (const [x, z] of [
    [x0, z0],
    [x1, z0],
    [x0, z1],
    [x1, z1],
  ]) {
    edges.push([
      [x, h0, z],
      [x, h1, z],
    ]);
  }
  return edges;
}

/** Chest: a wireframe box with a lid seam ring. */
const CHEST_MODEL: readonly Seg3[] = [
  ...boxEdges(-0.22, 0.22, -0.5, -0.18, -0.16, 0.16),
  [
    [-0.22, -0.28, -0.16],
    [0.22, -0.28, -0.16],
  ],
  [
    [-0.22, -0.28, 0.16],
    [0.22, -0.28, 0.16],
  ],
  [
    [-0.22, -0.28, -0.16],
    [-0.22, -0.28, 0.16],
  ],
  [
    [0.22, -0.28, -0.16],
    [0.22, -0.28, 0.16],
  ],
];

/** Stairs down: three receding, shrinking, sinking steps - a descending well. */
const STAIRS_MODEL: readonly Seg3[] = [
  [
    [-0.2, -0.5, -0.15],
    [0.2, -0.5, -0.15],
  ],
  [
    [-0.15, -0.58, 0],
    [0.15, -0.58, 0],
  ],
  [
    [-0.1, -0.66, 0.15],
    [0.1, -0.66, 0.15],
  ],
  [
    [-0.2, -0.5, -0.15],
    [-0.15, -0.58, 0],
  ],
  [
    [0.2, -0.5, -0.15],
    [0.15, -0.58, 0],
  ],
  [
    [-0.15, -0.58, 0],
    [-0.1, -0.66, 0.15],
  ],
  [
    [0.15, -0.58, 0],
    [0.1, -0.66, 0.15],
  ],
];

/** Boss marker: an upright horned triangle. */
const BOSS_MODEL: readonly Seg3[] = [
  [
    [-0.25, -0.5, 0],
    [0.25, -0.5, 0],
  ],
  [
    [-0.25, -0.5, 0],
    [0, 0.15, 0],
  ],
  [
    [0.25, -0.5, 0],
    [0, 0.15, 0],
  ],
  [
    [0, 0.15, 0],
    [-0.12, 0.3, 0],
  ],
  [
    [0, 0.15, 0],
    [0.12, 0.3, 0],
  ],
];

const PROP_MODELS: Record<Exclude<DungeonFeature, "none">, readonly Seg3[]> = {
  chest: CHEST_MODEL,
  stairsDown: STAIRS_MODEL,
  bossMarker: BOSS_MODEL,
};

/** Densest allowed dither fill (fraction of dots lit) at MAX_DEPTH. */
const MAX_FILL = 0.55;

/** 4x4 ordered-dither thresholds; screen-anchored so coplanar faces mesh. */
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

/**
 * Fill density for a face whose center sits `depth` tiles ahead: near walls
 * clean, far walls dim. Keyed on view depth (not Euclidean distance) so the
 * coplanar faces of one flat wall shade uniformly instead of banding.
 */
function fillDensity(depth: number): number {
  return clamp((depth - 1) / MAX_DEPTH, 0, 1) * MAX_FILL;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/** Number of depth color bands (see `theme.DUNGEON_RAMPS`). */
export const DEPTH_BANDS = 4;

/** Depth band for a view depth: DEPTH_BANDS near the eye, 1 at MAX_DEPTH. */
function depthBand(depth: number): number {
  return (
    DEPTH_BANDS -
    Math.min(DEPTH_BANDS - 1, Math.floor(depth / (MAX_DEPTH / DEPTH_BANDS)))
  );
}

/**
 * Compose the first-person view as `viewport.height` rows of exactly
 * `viewport.width` characters (Braille wireframe on space). `camera` defaults
 * to the party's discrete pose; animation passes fractional poses.
 */
export function renderDungeonView(
  ds: DungeonState,
  viewport: Viewport,
  camera: CameraPose = poseFromState(ds),
): string[] {
  const { buf, dotW, dotH } = paintDungeonDots(ds, viewport, camera);
  return packBraille(buf, dotW, dotH);
}

/**
 * The FP view as rows of same-depth-band runs, for per-depth coloring (ROG-31
 * near-bright/far-dim). Joining each row's run texts reproduces
 * {@link renderDungeonView} exactly.
 */
export function renderDungeonViewRuns(
  ds: DungeonState,
  viewport: Viewport,
  camera: CameraPose = poseFromState(ds),
): BrailleRun[][] {
  const { buf, dotW, dotH } = paintDungeonDots(ds, viewport, camera);
  return packBrailleRuns(buf, dotW, dotH);
}

/** Shared paint pass: project and rasterize into a depth-band dot buffer. */
function paintDungeonDots(
  ds: DungeonState,
  viewport: Viewport,
  camera: CameraPose,
): { buf: Uint8Array; dotW: number; dotH: number } {
  const cols = Math.max(1, viewport.width);
  const rows = Math.max(1, viewport.height);
  const dotW = cols * 2;
  const dotH = rows * 4;
  // Braille dots are square under the standard 1:2 terminal cell aspect, so
  // one focal serves both axes; the dotH clamp keeps squat viewports sane.
  const focal = Math.min(0.45 * dotW, 0.85 * dotH);
  const cxDot = dotW / 2;
  const cyDot = dotH / 2;

  const fwdX = Math.sin(camera.angle);
  const fwdY = -Math.cos(camera.angle);
  const rgtX = -fwdY;
  const rgtY = fwdX;
  /** World ground point -> camera space (x lateral, z depth ahead). */
  const toCam = (wx: number, wy: number) => {
    const dx = wx - camera.x;
    const dy = wy - camera.y;
    return { x: dx * rgtX + dy * rgtY, z: dx * fwdX + dy * fwdY };
  };
  // Points just past the near plane project enormous; clamp every screen
  // coordinate so Bresenham never walks an unbounded line.
  const projectEdge = (camX: number, camZ: number): Edge => ({
    sx: clamp(cxDot + (focal * camX) / camZ, -dotW, 2 * dotW),
    syT: clamp(cyDot - (focal * 0.5) / camZ, -dotH, 2 * dotH),
    syB: clamp(cyDot + (focal * 0.5) / camZ, -dotH, 2 * dotH),
  });

  const wall = (x: number, y: number) => isDungeonWall(ds.layout, { x, y });

  const items: DrawItem[] = [];
  const cellX = Math.round(camera.x);
  const cellY = Math.round(camera.y);
  for (let cy = cellY - RANGE; cy <= cellY + RANGE; cy++) {
    for (let cx = cellX - RANGE; cx <= cellX + RANGE; cx++) {
      if (!wall(cx, cy)) {
        const feature = tileFeature(ds.layout, { x: cx, y: cy });
        if (feature === "none") continue;
        const depth = toCam(cx, cy).z;
        if (depth <= Z_NEAR || depth > MAX_DEPTH) continue;
        const lines: PropItem["lines"] = [];
        for (const [pa, pb] of PROP_MODELS[feature]) {
          const ga = toCam(cx + pa[0], cy + pa[2]);
          const gb = toCam(cx + pb[0], cy + pb[2]);
          // Props sit in cells ahead; drop rather than clip grazing segments.
          if (ga.z <= Z_NEAR || gb.z <= Z_NEAR) continue;
          lines.push({
            x0: clamp(cxDot + (focal * ga.x) / ga.z, -dotW, 2 * dotW),
            y0: clamp(cyDot - (focal * pa[1]) / ga.z, -dotH, 2 * dotH),
            x1: clamp(cxDot + (focal * gb.x) / gb.z, -dotW, 2 * dotW),
            y1: clamp(cyDot - (focal * pb[1]) / gb.z, -dotH, 2 * dotH),
          });
        }
        if (lines.length > 0) {
          const distSq = (camera.x - cx) ** 2 + (camera.y - cy) ** 2;
          items.push({ kind: "prop", distSq, band: depthBand(depth), lines });
        }
        continue;
      }
      for (const f of FACE_DIRS) {
        if (wall(cx + f.nx, cy + f.ny)) continue; // interior face
        const fcx = cx + f.nx * 0.5;
        const fcy = cy + f.ny * 0.5;
        // Backface cull: camera must be on the outward side of the plane.
        if ((camera.x - fcx) * f.nx + (camera.y - fcy) * f.ny <= 0) continue;
        let a = toCam(fcx - f.rx * 0.5, fcy - f.ry * 0.5);
        let b = toCam(fcx + f.rx * 0.5, fcy + f.ry * 0.5);
        if (a.z <= Z_NEAR && b.z <= Z_NEAR) continue;
        if (Math.min(a.z, b.z) > MAX_DEPTH) continue;
        // Suppress the jamb at an end whose along-the-run neighbor shows a
        // coplanar face, so a straight wall reads as one plane, not panels.
        let jamb0 =
          !wall(cx - f.rx, cy - f.ry) ||
          wall(cx - f.rx + f.nx, cy - f.ry + f.ny);
        let jamb1 =
          !wall(cx + f.rx, cy + f.ry) ||
          wall(cx + f.rx + f.nx, cy + f.ry + f.ny);
        if (a.z <= Z_NEAR) {
          a = clipNear(a, b);
          jamb0 = false;
        } else if (b.z <= Z_NEAR) {
          b = clipNear(b, a);
          jamb1 = false;
        }
        const e0 = projectEdge(a.x, a.z);
        const e1 = projectEdge(b.x, b.z);
        if ((e0.sx < 0 && e1.sx < 0) || (e0.sx >= dotW && e1.sx >= dotW)) {
          continue;
        }
        const distSq = (camera.x - fcx) ** 2 + (camera.y - fcy) ** 2;
        const viewDepth = toCam(fcx, fcy).z;
        items.push({
          kind: "face",
          distSq,
          e0,
          e1,
          jamb0,
          jamb1,
          density: fillDensity(viewDepth),
          band: depthBand(viewDepth),
        });
      }
    }
  }

  // Painter's algorithm: farthest first, nearer faces overwrite. Props are
  // transparent wireframes; a nearer wall still paints over them.
  items.sort((p, q) => q.distSq - p.distSq);
  const buf = createDotCanvas(dotW, dotH);
  for (const item of items) {
    if (item.kind === "face") {
      drawFace(buf, dotW, dotH, item);
    } else {
      for (const l of item.lines) {
        plotLine(buf, dotW, dotH, l.x0, l.y0, l.x1, l.y1, item.band);
      }
    }
  }
  return { buf, dotW, dotH };
}

/** Clip the behind-camera endpoint of a segment to the near plane. */
function clipNear(
  behind: { x: number; z: number },
  front: { x: number; z: number },
): { x: number; z: number } {
  const t = (Z_NEAR - behind.z) / (front.z - behind.z);
  return { x: behind.x + (front.x - behind.x) * t, z: Z_NEAR };
}

/**
 * Rasterize one face: overwrite its interior column by column with its own
 * dither fill (erasing anything farther already painted), then draw its
 * solid edges on top.
 */
function drawFace(
  buf: Uint8Array,
  dotW: number,
  dotH: number,
  face: FaceItem,
): void {
  let left = face.e0;
  let right = face.e1;
  let jambL = face.jamb0;
  let jambR = face.jamb1;
  if (left.sx > right.sx) {
    [left, right] = [right, left];
    [jambL, jambR] = [jambR, jambL];
  }
  const span = right.sx - left.sx;
  if (span > 1e-3) {
    const x0 = Math.max(0, Math.ceil(left.sx));
    const x1 = Math.min(dotW - 1, Math.floor(right.sx));
    for (let x = x0; x <= x1; x++) {
      const t = (x - left.sx) / span;
      const yT = clamp(
        Math.round(left.syT + (right.syT - left.syT) * t),
        0,
        dotH - 1,
      );
      const yB = clamp(
        Math.round(left.syB + (right.syB - left.syB) * t),
        0,
        dotH - 1,
      );
      for (let y = yT; y <= yB; y++) {
        buf[y * dotW + x] =
          BAYER4[y & 3][x & 3] / 16 < face.density ? face.band : 0;
      }
    }
  }
  const band = face.band;
  plotLine(buf, dotW, dotH, left.sx, left.syT, right.sx, right.syT, band);
  plotLine(buf, dotW, dotH, left.sx, left.syB, right.sx, right.syB, band);
  if (jambL) {
    plotLine(buf, dotW, dotH, left.sx, left.syT, left.sx, left.syB, band);
  }
  if (jambR) {
    plotLine(buf, dotW, dotH, right.sx, right.syT, right.sx, right.syB, band);
  }
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
