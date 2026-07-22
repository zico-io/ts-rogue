/**
 * Pixi counterpart of `src/ui/screens/overworld/render.ts` +
 * `OverworldScreen.tsx` (ROG-49). Reuses the TUI's pure camera/viewport and
 * minimap helpers unmodified - `buildViewportRows`/`buildMinimapRows` already
 * do all the "what tile goes where, clamped and centered on the player"
 * math; this module only changes how a `Cell` gets drawn (a keyed sprite
 * instead of a glyph character) and adds a graphical encounter-meter bar in
 * place of the TUI's `#`/`.` text bar.
 *
 * There is no persistent reveal/explored mask here (unlike the dungeon's
 * `DungeonState.explored`) - the overworld's only "fog" is the camera
 * viewport itself: tiles outside `buildViewportRows`'s window are simply
 * never given a draw object, exactly as the TUI never renders them as text.
 *
 * Framework-free (no `pixi.js` import) behind a small `OverworldDrawFactory`
 * interface, following `sceneView.ts`/`SceneChromeView`'s split so this is
 * unit-testable with a fake factory (see `overworldView.test.ts`); the real
 * Pixi adapter lives in `pixiOverworldDrawFactory.ts`. Draw objects are kept
 * in maps keyed by stable strings and reused across `render()` calls, since
 * the tilemap redraws on every player step - unlike the village/title menus
 * in `main.ts`, this is not cheap to destroy-and-rebuild every frame.
 */

import type { GameState } from "../../engine/state/types";
import { ENCOUNTER_THRESHOLD } from "../../engine/world/overworld";
import type { OverworldMap } from "../../engine/world/types";
import {
  buildMinimapRows,
  buildViewportRows,
  type Cell,
} from "../../ui/screens/overworld/render";
import { theme, toPixiColor } from "../../ui/theme";
import type { TileName } from "../../ui/tiles/kitty";
import type { DrawHandle, RectHandle } from "./sceneView";

/** A positioned, keyed, texture-backed tile. */
export interface SpriteHandle extends DrawHandle {
  setTexture(name: TileName): void;
  /** `0xffffff` (no tint) leaves the texture's own colors untouched. */
  setTint(color: number): void;
}

/** Renderer boundary this view draws through: sprites for tiles, rects for meter/minimap chrome. */
export interface OverworldDrawFactory {
  createSprite(): SpriteHandle;
  createRect(): RectHandle;
}

/** Pixel size of the region the view has to work with. */
export interface PixelSize {
  width: number;
  height: number;
}

/** Pixel size of one main-viewport tile; the minimap always draws smaller than this. */
const DEFAULT_TILE_PX = 24;
/** Pixel size of one minimap cell - deliberately small, it's an overview, not a second viewport. */
const MINIMAP_TILE_PX = 4;
/** Padding inside the minimap's border rect, and the gap between viewport and minimap. */
const MINIMAP_PAD_PX = 6;
const MINIMAP_GAP_PX = 10;
/** Encounter meter bar: height, and the gap separating it from the viewport above it. */
const METER_HEIGHT_PX = 14;
const METER_GAP_PX = 10;

/**
 * `Tile`/`"player"` -> theme biome color, converted to Pixi's `0xRRGGBB` int.
 * `Cell.tile` is typed as the broader `TileName` (it shares the atlas's
 * frame-name alphabet), but overworld cells only ever carry a `Tile` or
 * `"player"`; anything else falls back to plain white (no tint).
 */
function biomeTint(tile: TileName): number {
  const hex = (theme.biome as Partial<Record<TileName, string>>)[tile];
  return hex ? toPixiColor(hex) : 0xffffff;
}

/**
 * Draws the overworld's camera-follow tilemap, a whole-map minimap, and the
 * encounter meter, matching the TUI's layout intent (viewport + minimap side
 * by side, meter below) without depending on Ink's box model.
 */
export class OverworldSceneView {
  private readonly viewportSprites = new Map<string, SpriteHandle>();
  private readonly minimapRects = new Map<string, RectHandle>();
  private minimapBorder: RectHandle | undefined;
  private meterBackground: RectHandle | undefined;
  private meterFill: RectHandle | undefined;

  constructor(private readonly factory: OverworldDrawFactory) {}

  /**
   * Renders one frame. `tilePx` is the pixel size of a main-viewport tile;
   * the minimap and meter size themselves off `pixelSize` independently.
   */
  render(
    state: GameState,
    map: OverworldMap,
    pixelSize: PixelSize,
    tilePx: number = DEFAULT_TILE_PX,
  ): void {
    const player = state.worldState.player;
    const contentHeight = Math.max(
      1,
      pixelSize.height - METER_HEIGHT_PX - METER_GAP_PX,
    );

    const minimapMaxCols = Math.max(
      1,
      Math.floor(
        (pixelSize.width * 0.3 - MINIMAP_PAD_PX * 2) / MINIMAP_TILE_PX,
      ),
    );
    const minimapMaxRows = Math.max(
      1,
      Math.floor((contentHeight - MINIMAP_PAD_PX * 2) / MINIMAP_TILE_PX),
    );
    const minimapRows = buildMinimapRows(map, player, {
      maxWidth: minimapMaxCols,
      maxHeight: minimapMaxRows,
    });
    const minimapCols = minimapRows[0]?.length ?? 0;
    const minimapBoxWidth = minimapCols * MINIMAP_TILE_PX + MINIMAP_PAD_PX * 2;
    const minimapBoxHeight =
      minimapRows.length * MINIMAP_TILE_PX + MINIMAP_PAD_PX * 2;
    const minimapBoxX = Math.max(0, pixelSize.width - minimapBoxWidth);

    const seenSprites = new Set<string>();
    const seenMinimapRects = new Set<string>();

    const viewportAreaWidth = Math.max(1, minimapBoxX - MINIMAP_GAP_PX);
    const viewportCols = Math.max(1, Math.floor(viewportAreaWidth / tilePx));
    const viewportRowsCount = Math.max(1, Math.floor(contentHeight / tilePx));
    const viewportRows = buildViewportRows(map, player, {
      width: viewportCols,
      height: viewportRowsCount,
    });
    this.drawViewport(viewportRows, tilePx, seenSprites);
    this.pruneStaleSprites(seenSprites);

    this.drawMinimap(
      minimapRows,
      minimapBoxX,
      0,
      minimapBoxWidth,
      minimapBoxHeight,
      seenMinimapRects,
    );
    this.pruneStaleMinimapRects(seenMinimapRects);

    this.drawMeter(
      state.worldState.encounterMeter,
      pixelSize.width,
      contentHeight + METER_GAP_PX,
    );
  }

  private drawViewport(
    rows: Cell[][],
    tilePx: number,
    seen: Set<string>,
  ): void {
    for (const [rowIndex, row] of rows.entries()) {
      for (const [colIndex, cell] of row.entries()) {
        seen.add(cell.key);
        let sprite = this.viewportSprites.get(cell.key);
        if (!sprite) {
          sprite = this.factory.createSprite();
          this.viewportSprites.set(cell.key, sprite);
        }
        sprite.setPosition(colIndex * tilePx, rowIndex * tilePx);
        const tile = cell.tile ?? "grass";
        sprite.setTexture(tile);
        sprite.setTint(biomeTint(tile));
      }
    }
  }

  private pruneStaleSprites(seen: Set<string>): void {
    for (const [key, sprite] of this.viewportSprites) {
      if (!seen.has(key)) {
        sprite.destroy();
        this.viewportSprites.delete(key);
      }
    }
  }

  private drawMinimap(
    rows: Cell[][],
    boxX: number,
    boxY: number,
    boxWidth: number,
    boxHeight: number,
    seen: Set<string>,
  ): void {
    if (!this.minimapBorder) this.minimapBorder = this.factory.createRect();
    this.minimapBorder.setPosition(boxX, boxY);
    this.minimapBorder.setSize(boxWidth, boxHeight);
    this.minimapBorder.setColor(toPixiColor(theme.border));

    for (const [rowIndex, row] of rows.entries()) {
      for (const [colIndex, cell] of row.entries()) {
        const key = `mm:${cell.key}`;
        seen.add(key);
        let rect = this.minimapRects.get(key);
        if (!rect) {
          rect = this.factory.createRect();
          this.minimapRects.set(key, rect);
        }
        rect.setPosition(
          boxX + MINIMAP_PAD_PX + colIndex * MINIMAP_TILE_PX,
          boxY + MINIMAP_PAD_PX + rowIndex * MINIMAP_TILE_PX,
        );
        rect.setSize(MINIMAP_TILE_PX, MINIMAP_TILE_PX);
        rect.setColor(toPixiColor(cell.color));
      }
    }
  }

  private pruneStaleMinimapRects(seen: Set<string>): void {
    for (const [key, rect] of this.minimapRects) {
      if (!seen.has(key)) {
        rect.destroy();
        this.minimapRects.delete(key);
      }
    }
  }

  private drawMeter(meter: number, width: number, y: number): void {
    const ratio = Math.max(0, Math.min(1, meter / ENCOUNTER_THRESHOLD));

    if (!this.meterBackground) {
      this.meterBackground = this.factory.createRect();
    }
    this.meterBackground.setPosition(0, y);
    this.meterBackground.setSize(width, METER_HEIGHT_PX);
    this.meterBackground.setColor(toPixiColor(theme.textFaint));

    if (!this.meterFill) this.meterFill = this.factory.createRect();
    this.meterFill.setPosition(0, y);
    this.meterFill.setSize(width * ratio, METER_HEIGHT_PX);
    this.meterFill.setColor(toPixiColor(theme.accent));
  }
}
