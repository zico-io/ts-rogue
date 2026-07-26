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

export interface Viewport {
  width: number;
  height: number;
}

export interface CameraPose {
  x: number;
  y: number;
  angle: number;
}

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

export function poseFromState(ds: DungeonState): CameraPose {
  return { x: ds.player.x, y: ds.player.y, angle: FACING_ANGLE[ds.facing] };
}

const TAU = 2 * Math.PI;

export function lerpPose(a: CameraPose, b: CameraPose, t: number): CameraPose {
  const arc = ((((b.angle - a.angle) % TAU) + TAU + Math.PI) % TAU) - Math.PI;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    angle: a.angle + arc * t,
  };
}

const Z_NEAR = 0.05;

const MAX_DEPTH = 6.5;

const RANGE = 7;

const FACE_DIRS = [
  { nx: 0, ny: -1, rx: 1, ry: 0 },
  { nx: 0, ny: 1, rx: 1, ry: 0 },
  { nx: -1, ny: 0, rx: 0, ry: 1 },
  { nx: 1, ny: 0, rx: 0, ry: 1 },
] as const;

interface Edge {
  sx: number;
  syT: number;
  syB: number;
}

interface FaceItem {
  kind: "face";
  distSq: number;
  e0: Edge;
  e1: Edge;
  jamb0: boolean;
  jamb1: boolean;
  density: number;

  band: number;
}

interface PropItem {
  kind: "prop";
  distSq: number;
  band: number;
  lines: Array<{ x0: number; y0: number; x1: number; y1: number }>;
}

type DrawItem = FaceItem | PropItem;

type Seg3 = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
];

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

const MAX_FILL = 0.55;

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

function fillDensity(depth: number): number {
  return clamp((depth - 1) / MAX_DEPTH, 0, 1) * MAX_FILL;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

export const DEPTH_BANDS = 4;

function depthBand(depth: number): number {
  return (
    DEPTH_BANDS -
    Math.min(DEPTH_BANDS - 1, Math.floor(depth / (MAX_DEPTH / DEPTH_BANDS)))
  );
}

export function renderDungeonView(
  ds: DungeonState,
  viewport: Viewport,
  camera: CameraPose = poseFromState(ds),
): string[] {
  const { buf, dotW, dotH } = paintDungeonDots(ds, viewport, camera);
  return packBraille(buf, dotW, dotH);
}

export function renderDungeonViewRuns(
  ds: DungeonState,
  viewport: Viewport,
  camera: CameraPose = poseFromState(ds),
): BrailleRun[][] {
  const { buf, dotW, dotH } = paintDungeonDots(ds, viewport, camera);
  return packBrailleRuns(buf, dotW, dotH);
}

function paintDungeonDots(
  ds: DungeonState,
  viewport: Viewport,
  camera: CameraPose,
): { buf: Uint8Array; dotW: number; dotH: number } {
  const cols = Math.max(1, viewport.width);
  const rows = Math.max(1, viewport.height);
  const dotW = cols * 2;
  const dotH = rows * 4;

  const focal = Math.min(0.45 * dotW, 0.85 * dotH);
  const cxDot = dotW / 2;
  const cyDot = dotH / 2;

  const fwdX = Math.sin(camera.angle);
  const fwdY = -Math.cos(camera.angle);
  const rgtX = -fwdY;
  const rgtY = fwdX;

  const toCam = (wx: number, wy: number) => {
    const dx = wx - camera.x;
    const dy = wy - camera.y;
    return { x: dx * rgtX + dy * rgtY, z: dx * fwdX + dy * fwdY };
  };

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
        if (wall(cx + f.nx, cy + f.ny)) continue;
        const fcx = cx + f.nx * 0.5;
        const fcy = cy + f.ny * 0.5;

        if ((camera.x - fcx) * f.nx + (camera.y - fcy) * f.ny <= 0) continue;
        let a = toCam(fcx - f.rx * 0.5, fcy - f.ry * 0.5);
        let b = toCam(fcx + f.rx * 0.5, fcy + f.ry * 0.5);
        if (a.z <= Z_NEAR && b.z <= Z_NEAR) continue;
        if (Math.min(a.z, b.z) > MAX_DEPTH) continue;

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

function clipNear(
  behind: { x: number; z: number },
  front: { x: number; z: number },
): { x: number; z: number } {
  const t = (Z_NEAR - behind.z) / (front.z - behind.z);
  return { x: behind.x + (front.x - behind.x) * t, z: Z_NEAR };
}

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

export function renderMinimap(
  ds: DungeonState,
  width = MINIMAP_WIDTH,
  height = MINIMAP_HEIGHT,
): string[] {
  const layout = ds.layout;
  const halfWidth = Math.floor(width / 2);
  const halfHeight = Math.floor(height / 2);
  const ox = clamp(
    ds.player.x - halfWidth,
    0,
    Math.max(0, layout.width - width),
  );
  const oy = clamp(
    ds.player.y - halfHeight,
    0,
    Math.max(0, layout.height - height),
  );
  const rows: string[] = [];
  for (let my = 0; my < height; my++) {
    let row = "";
    for (let mx = 0; mx < width; mx++) {
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
