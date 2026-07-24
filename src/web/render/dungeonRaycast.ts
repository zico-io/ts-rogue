/**
 * Framework-free classic DDA raycaster (ROG-50), the browser counterpart of
 * the TUI's perspective wall-face renderer (`src/ui/screens/dungeon/render.ts`).
 * No `pixi.js` import - this only computes screen-space geometry (column
 * positions/heights, billboard positions/sizes) from a `DungeonState` and a
 * `CameraPose`; `dungeonView.ts` turns that geometry into draw calls.
 *
 * Uses the standard "camera plane" raycasting method (Lodev's tutorial is the
 * canonical writeup): each screen column gets a `cameraX` in [-1, 1], and its
 * ray direction is `forward + right * planeLength * cameraX` where
 * `planeLength = tan(fov / 2)`. The resulting per-column wall distance is
 * already perpendicular (not the raw ray length), so no separate fisheye
 * correction step is needed - it falls out of the method.
 *
 * Coordinate note: the engine's dungeon grid treats tile `(x, y)`'s *center*
 * as world position `(x, y)` itself (see `render.ts`'s `FACE_DIRS`/`toCam`
 * usage and `world/dungeon.ts`'s movement deltas) - i.e. a tile spans
 * `[x - 0.5, x + 0.5)`. The DDA algorithm below assumes the opposite
 * convention (a tile spans `[x, x + 1)`), so every DDA computation is done in
 * a position shifted by `+0.5` on both axes; `Math.floor` of the shifted
 * position then lands exactly on the real tile index, matching
 * `isDungeonWall`/`tileFeature`'s indexing and `render.ts`'s own
 * `Math.round(camera.x)` "current cell" convention.
 */

import { isDungeonWall, tileFeature } from "../../engine/world/dungeon";
import type {
  DungeonFeature,
  DungeonState,
  Point,
} from "../../engine/world/types";
import { type CameraPose, DEPTH_BANDS } from "../../ui/screens/dungeon/render";

/** Horizontal field of view; a common raycaster default. */
export const FOV_DEGREES = 66;
const FOV_RADIANS = (FOV_DEGREES * Math.PI) / 180;
const PLANE_LENGTH = Math.tan(FOV_RADIANS / 2);

/** One ray per this many viewport pixels - decouples ray count from device pixels (see `overworldView.ts`'s `DEFAULT_TILE_PX` for the same idea). */
export const RAY_STRIP_PX = 4;

/** Perpendicular distance (tiles) beyond which nothing is drawn - the corridor fades to darkness. */
export const MAX_DEPTH = 8;

/** Native wall tile width in the atlas (ROG-68: the shared 8x8 Minifantasy grid) - the number of distinct texel columns a wall face samples from. */
export const TEXELS_PER_TILE = 8;

/** Safety cap on DDA steps per ray; `isDungeonWall` treats out-of-bounds as a wall, so this is only reached in pathological layouts. */
const MAX_DDA_STEPS = 64;

/** Which grid axis a wall was hit on - determines the texel-sampling axis. */
export type WallSide = "ns" | "ew";

/**
 * One screen column's wall hit, in viewport-pixel space. `castWallColumns`
 * always returns exactly one entry per ray, in screen order, even when a ray
 * hits nothing (`distance: Infinity`, zero-height `top`/`bottom`) - the array
 * stays densely indexable by screen column, which `castBillboards` relies on
 * for its occlusion lookup.
 */
export interface WallColumn {
  screenX: number;
  width: number;
  top: number;
  bottom: number;
  /** Perpendicular distance in tiles; `Infinity` when the ray hit nothing within `MAX_DEPTH`. */
  distance: number;
  /** Depth band, `DEPTH_BANDS` (near) .. 1 (far), matching the TUI's convention. */
  band: number;
  /** Texel column (0..`TEXELS_PER_TILE - 1`) to sample from the wall texture. */
  texel: number;
  side: WallSide;
}

/** A billboarded feature (chest/stairs/boss marker) projected into screen space. */
export interface Billboard {
  feature: DungeonFeature;
  cell: Point;
  screenX: number;
  screenY: number;
  size: number;
  distance: number;
  band: number;
}

interface PixelSize {
  width: number;
  height: number;
}

/** Depth band for a perpendicular distance: `DEPTH_BANDS` near the eye, 1 at `MAX_DEPTH`. Mirrors `render.ts`'s `depthBand`. */
function depthBand(distance: number): number {
  return Math.max(
    1,
    DEPTH_BANDS -
      Math.min(
        DEPTH_BANDS - 1,
        Math.floor(distance / (MAX_DEPTH / DEPTH_BANDS)),
      ),
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/** Forward/right unit vectors for `angle`, matching `render.ts`'s convention (north = angle 0 = -y). */
function cameraAxes(angle: number): {
  fwdX: number;
  fwdY: number;
  rgtX: number;
  rgtY: number;
} {
  const fwdX = Math.sin(angle);
  const fwdY = -Math.cos(angle);
  return { fwdX, fwdY, rgtX: -fwdY, rgtY: fwdX };
}

/** Casts one ray via DDA against `isDungeonWall`. Returns `undefined` if nothing is hit within `MAX_DEPTH`. */
function castRay(
  ds: DungeonState,
  camera: CameraPose,
  rayDirX: number,
  rayDirY: number,
): { distance: number; side: WallSide; wallX: number } | undefined {
  const px = camera.x + 0.5;
  const py = camera.y + 0.5;
  let mapX = Math.floor(px);
  let mapY = Math.floor(py);

  const deltaDistX =
    rayDirX === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / rayDirX);
  const deltaDistY =
    rayDirY === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / rayDirY);

  const stepX = rayDirX < 0 ? -1 : 1;
  const stepY = rayDirY < 0 ? -1 : 1;
  let sideDistX =
    rayDirX < 0 ? (px - mapX) * deltaDistX : (mapX + 1 - px) * deltaDistX;
  let sideDistY =
    rayDirY < 0 ? (py - mapY) * deltaDistY : (mapY + 1 - py) * deltaDistY;

  let side: 0 | 1 = 0;
  for (let step = 0; step < MAX_DDA_STEPS; step++) {
    if (Math.min(sideDistX, sideDistY) > MAX_DEPTH) return undefined;
    if (sideDistX < sideDistY) {
      mapX += stepX;
      sideDistX += deltaDistX;
      side = 0;
    } else {
      mapY += stepY;
      sideDistY += deltaDistY;
      side = 1;
    }
    if (isDungeonWall(ds.layout, { x: mapX, y: mapY })) {
      const perpWallDist =
        side === 0
          ? (mapX - px + (1 - stepX) / 2) / rayDirX
          : (mapY - py + (1 - stepY) / 2) / rayDirY;
      if (perpWallDist > MAX_DEPTH) return undefined;
      const wallCoord =
        side === 0 ? py + perpWallDist * rayDirY : px + perpWallDist * rayDirX;
      const wallX = wallCoord - Math.floor(wallCoord);
      return { distance: perpWallDist, side: side === 0 ? "ew" : "ns", wallX };
    }
  }
  return undefined;
}

/**
 * Casts one wall column per `RAY_STRIP_PX` viewport pixels. Columns whose ray
 * hits nothing within `MAX_DEPTH` are omitted (the view draws bare
 * floor/ceiling for that strip - an open corridor fading to darkness).
 */
export function castWallColumns(
  ds: DungeonState,
  camera: CameraPose,
  viewport: PixelSize,
): WallColumn[] {
  const width = Math.max(1, viewport.width);
  const height = Math.max(1, viewport.height);
  const numColumns = Math.max(1, Math.round(width / RAY_STRIP_PX));
  const stripWidth = width / numColumns;
  const { fwdX, fwdY, rgtX, rgtY } = cameraAxes(camera.angle);

  const columns: WallColumn[] = [];
  for (let i = 0; i < numColumns; i++) {
    const cameraX = ((i + 0.5) / numColumns) * 2 - 1;
    const rayDirX = fwdX + rgtX * PLANE_LENGTH * cameraX;
    const rayDirY = fwdY + rgtY * PLANE_LENGTH * cameraX;
    const hit = castRay(ds, camera, rayDirX, rayDirY);
    if (!hit) {
      // No wall within MAX_DEPTH: a zero-height placeholder keeps the array
      // densely indexable by screen column (see the `WallColumn` doc comment).
      columns.push({
        screenX: i * stripWidth,
        width: stripWidth,
        top: height / 2,
        bottom: height / 2,
        distance: Number.POSITIVE_INFINITY,
        band: 1,
        texel: 0,
        side: "ew",
      });
      continue;
    }

    const lineHeight = height / hit.distance;
    const top = height / 2 - lineHeight / 2;
    columns.push({
      screenX: i * stripWidth,
      width: stripWidth,
      top,
      bottom: top + lineHeight,
      distance: hit.distance,
      band: depthBand(hit.distance),
      texel: clamp(
        Math.floor(hit.wallX * TEXELS_PER_TILE),
        0,
        TEXELS_PER_TILE - 1,
      ),
      side: hit.side,
    });
  }
  return columns;
}

/** Chebyshev radius scanned around the camera for candidate billboarded features - mirrors `render.ts`'s `RANGE`. */
const FEATURE_SCAN_RANGE = Math.ceil(MAX_DEPTH) + 1;
/** A billboard's world size (tile fraction) - how tall/wide it renders relative to a full wall face. */
const BILLBOARD_SCALE = 0.6;
/** Distance in front of the camera below which a billboard is behind/inside the eye and skipped. */
const NEAR_EPS = 0.1;

/**
 * Projects every in-view `chest`/`stairsDown`/`bossMarker` feature to screen
 * space, culling anything behind the camera, beyond `MAX_DEPTH`, or occluded
 * by a nearer wall at its screen column (a single center-point distance
 * test against `columns` - matching the TUI renderer's own painter's-
 * algorithm-level fidelity, not per-pixel clipping).
 */
export function castBillboards(
  ds: DungeonState,
  camera: CameraPose,
  viewport: PixelSize,
  columns: readonly WallColumn[],
): Billboard[] {
  const width = Math.max(1, viewport.width);
  const height = Math.max(1, viewport.height);
  const { fwdX, fwdY, rgtX, rgtY } = cameraAxes(camera.angle);

  const cellX = Math.round(camera.x);
  const cellY = Math.round(camera.y);
  const billboards: Billboard[] = [];

  for (
    let y = cellY - FEATURE_SCAN_RANGE;
    y <= cellY + FEATURE_SCAN_RANGE;
    y++
  ) {
    for (
      let x = cellX - FEATURE_SCAN_RANGE;
      x <= cellX + FEATURE_SCAN_RANGE;
      x++
    ) {
      const feature = tileFeature(ds.layout, { x, y });
      if (feature === "none") continue;

      const dx = x - camera.x;
      const dy = y - camera.y;
      const depth = dx * fwdX + dy * fwdY;
      if (depth <= NEAR_EPS || depth > MAX_DEPTH) continue;
      const lateral = dx * rgtX + dy * rgtY;

      const cameraX = lateral / (depth * PLANE_LENGTH);
      if (cameraX < -1.5 || cameraX > 1.5) continue; // well outside the view frustum
      const screenX = ((cameraX + 1) / 2) * width;

      const column =
        columns[
          clamp(
            Math.floor(screenX / (width / Math.max(1, columns.length))),
            0,
            columns.length - 1,
          )
        ];
      if (column && depth > column.distance) continue; // occluded by a nearer wall

      const size = (height / depth) * BILLBOARD_SCALE;
      billboards.push({
        feature,
        cell: { x, y },
        screenX,
        screenY: height / 2,
        size,
        distance: depth,
        band: depthBand(depth),
      });
    }
  }
  return billboards;
}
