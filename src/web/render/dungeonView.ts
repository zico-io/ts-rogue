/**
 * Pixi counterpart of `src/ui/screens/dungeon/render.ts` + `DungeonScreen.tsx`
 * (ROG-50). Draws the classic textured-raycaster geometry `dungeonRaycast.ts`
 * computes - flat depth-tinted ceiling/floor, per-column wall strips sampled
 * from the wall texture's texel-cropped sub-textures, and chest/stairs/boss
 * billboards - plus a graphical minimap corner overlay (reusing the TUI's own
 * pure `renderMinimap` glyph rows) and a one-line status readout.
 *
 * Framework-free (no `pixi.js` import) behind a small `DungeonDrawFactory`
 * interface, following `overworldView.ts`/`battleView.ts`'s split so this is
 * unit-testable with a fake factory (see `dungeonView.test.ts`); the real
 * Pixi adapter lives in `pixiDungeonDrawFactory.ts`. Draw objects are kept in
 * maps keyed by column index / cell coordinate / minimap cell and reused
 * across `render()` calls, matching the other tilemap-style views.
 *
 * v1 scope (ROG-50): no move/turn tween - renders `poseFromState(ds)`
 * directly every call, the issue explicitly allows instant movement for v1.
 * Floor/ceiling are flat depth-independent colors, not raycast/textured -
 * the original Wolfenstein 3D's own approach, and still satisfies "reuse
 * `DUNGEON_RAMPS` for distance fog/tinting" since walls carry the real
 * per-column depth tint. Billboard occlusion is the single center-column
 * distance test `dungeonRaycast.ts` already applies - no per-pixel clipping,
 * matching the TUI renderer's own painter's-algorithm-level fidelity.
 */

import type { DungeonFacing, DungeonState } from "../../engine/world/types";
import { poseFromState, renderMinimap } from "../../ui/screens/dungeon/render";
import { dungeonRamp, theme, toPixiColor } from "../../ui/theme";
import {
  type Billboard,
  castBillboards,
  castWallColumns,
  MAX_DEPTH,
  type WallColumn,
} from "./dungeonRaycast";
import type { DrawHandle, RectHandle, TextHandle } from "./sceneView";

/** A positioned, texel-cropped wall-strip sprite. */
export interface WallColumnHandle extends DrawHandle {
  setSize(width: number, height: number): void;
  /** Which of the wall texture's `TEXELS_PER_TILE` vertical slices to show. */
  setTexel(texel: number): void;
  /** `0xffffff` (no tint) leaves the texture's own colors untouched. */
  setTint(color: number): void;
}

/** A positioned, square billboard sprite (top-left origin, matching `RectHandle`). */
export interface BillboardSpriteHandle extends DrawHandle {
  setSize(size: number): void;
  setTexture(name: string): void;
  setTint(color: number): void;
}

/** Renderer boundary this view draws through. */
export interface DungeonDrawFactory {
  createRect(): RectHandle;
  createWallColumn(): WallColumnHandle;
  createBillboardSprite(): BillboardSpriteHandle;
  createText(initialText: string): TextHandle;
}

export interface PixelSize {
  width: number;
  height: number;
}

/** Atlas frame name for each billboarded `DungeonFeature`. */
const BILLBOARD_TEXTURES = {
  chest: "chest",
  stairsDown: "stairsDown",
  bossMarker: "boss",
} as const;

/** Minimap cell pixel size and padding - deliberately small, an overview corner, not a second viewport. */
const MINIMAP_TILE_PX = 6;
const MINIMAP_PAD_PX = 6;
/** Gap between the minimap box's top-right corner and the viewport edge. */
const MINIMAP_MARGIN_PX = 8;
/** The player-facing indicator's size, a fraction of one minimap tile. */
const FACING_MARK_PX = 3;

const STATUS_TEXT_MARGIN_PX = 8;

/** Offset (in minimap tiles) from the player's cell toward its facing, for the small facing-indicator mark. */
const FACING_OFFSET: Record<DungeonFacing, { dx: number; dy: number }> = {
  north: { dx: 0, dy: -0.35 },
  east: { dx: 0.35, dy: 0 },
  south: { dx: 0, dy: 0.35 },
  west: { dx: -0.35, dy: 0 },
};

/** Glyph -> minimap cell color, mirroring `DungeonScreen.tsx`'s local `MINIMAP_TILES` table. `undefined` (blank) draws nothing - unexplored. */
function minimapCellColor(
  glyph: string,
  ramp: readonly string[],
): string | undefined {
  switch (glyph) {
    case "#":
      return theme.border;
    case ".":
      return ramp[0];
    case "C":
      return theme.gold;
    case ">":
      return theme.accent;
    case "B":
      return theme.danger;
    default:
      return undefined; // blank (unexplored) or a facing glyph (player's own cell, drawn separately)
  }
}

/** Scales a `0xRRGGBB` color's channels by `factor` (0..1), for the flat floor/ceiling shading. */
function scaleColor(color: number, factor: number): number {
  const r = Math.round(((color >> 16) & 0xff) * factor);
  const g = Math.round(((color >> 8) & 0xff) * factor);
  const b = Math.round((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

/**
 * Draws the raycast wall/billboard geometry, a flat ceiling/floor, a
 * graphical minimap corner, and a one-line facing/status readout.
 */
export class DungeonSceneView {
  private ceiling: RectHandle | undefined;
  private floor: RectHandle | undefined;
  private readonly columns = new Map<number, WallColumnHandle>();
  private readonly billboards = new Map<string, BillboardSpriteHandle>();
  private minimapBackground: RectHandle | undefined;
  private readonly minimapCells = new Map<string, RectHandle>();
  private playerMark: RectHandle | undefined;
  private facingMark: RectHandle | undefined;
  private statusText: TextHandle | undefined;

  constructor(private readonly factory: DungeonDrawFactory) {}

  render(ds: DungeonState, pixelSize: PixelSize): void {
    const camera = poseFromState(ds);
    const columns = castWallColumns(ds, camera, pixelSize);
    const billboards = castBillboards(ds, camera, pixelSize, columns);
    const ramp = dungeonRamp(ds.dungeonId);

    this.drawSky(pixelSize, ramp);
    this.drawColumns(columns, ramp);
    this.drawBillboards(billboards, ramp);
    this.drawMinimap(ds, ramp, pixelSize);
    this.drawStatus(ds, pixelSize);
  }

  private drawSky(pixelSize: PixelSize, ramp: readonly string[]): void {
    const baseColor = toPixiColor(ramp[0]);
    const halfHeight = pixelSize.height / 2;

    if (!this.ceiling) this.ceiling = this.factory.createRect();
    this.ceiling.setPosition(0, 0);
    this.ceiling.setSize(pixelSize.width, halfHeight);
    this.ceiling.setColor(scaleColor(baseColor, 0.4));

    if (!this.floor) this.floor = this.factory.createRect();
    this.floor.setPosition(0, halfHeight);
    this.floor.setSize(pixelSize.width, pixelSize.height - halfHeight);
    this.floor.setColor(scaleColor(baseColor, 0.25));
  }

  private drawColumns(
    columns: readonly WallColumn[],
    ramp: readonly string[],
  ): void {
    const seen = new Set<number>();
    for (const [index, column] of columns.entries()) {
      seen.add(index);
      let handle = this.columns.get(index);
      if (!handle) {
        handle = this.factory.createWallColumn();
        this.columns.set(index, handle);
      }
      if (!Number.isFinite(column.distance)) {
        handle.setPosition(column.screenX, 0);
        handle.setSize(column.width, 0);
        continue;
      }
      handle.setPosition(column.screenX, column.top);
      handle.setSize(column.width, column.bottom - column.top);
      handle.setTexel(column.texel);
      handle.setTint(toPixiColor(ramp[Math.max(0, column.band - 1)]));
    }
    for (const [index, handle] of this.columns) {
      if (!seen.has(index)) {
        handle.destroy();
        this.columns.delete(index);
      }
    }
  }

  private drawBillboards(
    billboards: readonly Billboard[],
    ramp: readonly string[],
  ): void {
    const seen = new Set<string>();
    for (const billboard of billboards) {
      const key = `${billboard.cell.x},${billboard.cell.y}`;
      seen.add(key);
      let handle = this.billboards.get(key);
      if (!handle) {
        handle = this.factory.createBillboardSprite();
        this.billboards.set(key, handle);
      }
      handle.setTexture(
        BILLBOARD_TEXTURES[
          billboard.feature as keyof typeof BILLBOARD_TEXTURES
        ],
      );
      handle.setSize(billboard.size);
      handle.setPosition(
        billboard.screenX - billboard.size / 2,
        billboard.screenY - billboard.size / 2,
      );
      handle.setTint(toPixiColor(ramp[Math.max(0, billboard.band - 1)]));
    }
    for (const [key, handle] of this.billboards) {
      if (!seen.has(key)) {
        handle.destroy();
        this.billboards.delete(key);
      }
    }
  }

  private drawMinimap(
    ds: DungeonState,
    ramp: readonly string[],
    pixelSize: PixelSize,
  ): void {
    const rows = renderMinimap(ds);
    const cols = rows[0]?.length ?? 0;
    const boxWidth = cols * MINIMAP_TILE_PX + MINIMAP_PAD_PX * 2;
    const boxHeight = rows.length * MINIMAP_TILE_PX + MINIMAP_PAD_PX * 2;
    const boxX = Math.max(0, pixelSize.width - boxWidth - MINIMAP_MARGIN_PX);
    const boxY = MINIMAP_MARGIN_PX;

    if (!this.minimapBackground)
      this.minimapBackground = this.factory.createRect();
    this.minimapBackground.setPosition(boxX, boxY);
    this.minimapBackground.setSize(boxWidth, boxHeight);
    this.minimapBackground.setColor(toPixiColor(theme.border));

    const seen = new Set<string>();
    let playerCol = -1;
    let playerRow = -1;
    for (const [rowIndex, row] of rows.entries()) {
      for (let colIndex = 0; colIndex < row.length; colIndex++) {
        const glyph = row[colIndex];
        if (glyph === "^" || glyph === ">" || glyph === "v" || glyph === "<") {
          playerCol = colIndex;
          playerRow = rowIndex;
        }
        const color = minimapCellColor(glyph, ramp);
        const key = `${rowIndex},${colIndex}`;
        if (color === undefined) {
          const stale = this.minimapCells.get(key);
          if (stale) {
            stale.destroy();
            this.minimapCells.delete(key);
          }
          continue;
        }
        seen.add(key);
        let cell = this.minimapCells.get(key);
        if (!cell) {
          cell = this.factory.createRect();
          this.minimapCells.set(key, cell);
        }
        cell.setPosition(
          boxX + MINIMAP_PAD_PX + colIndex * MINIMAP_TILE_PX,
          boxY + MINIMAP_PAD_PX + rowIndex * MINIMAP_TILE_PX,
        );
        cell.setSize(MINIMAP_TILE_PX, MINIMAP_TILE_PX);
        cell.setColor(toPixiColor(color));
      }
    }
    for (const [key, cell] of this.minimapCells) {
      if (!seen.has(key)) {
        cell.destroy();
        this.minimapCells.delete(key);
      }
    }

    if (playerCol < 0) return; // player's cell fell outside the windowed minimap - nothing to mark
    const playerX = boxX + MINIMAP_PAD_PX + playerCol * MINIMAP_TILE_PX;
    const playerY = boxY + MINIMAP_PAD_PX + playerRow * MINIMAP_TILE_PX;

    if (!this.playerMark) this.playerMark = this.factory.createRect();
    this.playerMark.setPosition(playerX, playerY);
    this.playerMark.setSize(MINIMAP_TILE_PX, MINIMAP_TILE_PX);
    this.playerMark.setColor(toPixiColor(theme.text));

    const offset = FACING_OFFSET[ds.facing];
    if (!this.facingMark) this.facingMark = this.factory.createRect();
    this.facingMark.setPosition(
      playerX +
        MINIMAP_TILE_PX / 2 +
        offset.dx * MINIMAP_TILE_PX -
        FACING_MARK_PX / 2,
      playerY +
        MINIMAP_TILE_PX / 2 +
        offset.dy * MINIMAP_TILE_PX -
        FACING_MARK_PX / 2,
    );
    this.facingMark.setSize(FACING_MARK_PX, FACING_MARK_PX);
    this.facingMark.setColor(toPixiColor(theme.accent));
  }

  private drawStatus(ds: DungeonState, pixelSize: PixelSize): void {
    const parts = [`Facing ${ds.facing}`];
    if (ds.reachedBoss) parts.push("boss room reached");
    if (ds.cleared) parts.push("dungeon cleared");

    if (!this.statusText) this.statusText = this.factory.createText("");
    this.statusText.setText(parts.join(" | "));
    this.statusText.setColor(toPixiColor(theme.textMuted));
    this.statusText.setPosition(
      STATUS_TEXT_MARGIN_PX,
      pixelSize.height - this.statusText.height - STATUS_TEXT_MARGIN_PX,
    );
  }
}

// Re-exported for callers that only need the raycaster's own depth cap
// alongside the view (e.g. tests asserting a feature outside MAX_DEPTH never
// renders).
export { MAX_DEPTH };
