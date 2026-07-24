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
 *
 * Viewport tiles also run through `overworldVariants.ts`'s neighbor-driven
 * auto-tile stand-in (ROG-73): a water tile bordering land grows a
 * shore-tinted fringe rect; a mountain tile swaps to a genuinely bigger/
 * smaller same-family rock crop as its cluster gets denser; every
 * mountain/forest/village/dungeonEntrance tile also scales with its local
 * density/position instead of always drawing at a fixed size - see that
 * module's doc comment for the full picture (and why there's no per-neighbor
 * bitmask shore autotile art here yet).
 */

import type { GameState } from "../../engine/state/types";
import { ENCOUNTER_THRESHOLD } from "../../engine/world/overworld";
import type { OverworldMap, Tile } from "../../engine/world/types";
import {
  buildMinimapRows,
  buildViewportRows,
  type Cell,
} from "../../ui/screens/overworld/render";
import { theme, toPixiColor } from "../../ui/theme";
import {
  clusterScale,
  landmarkScale,
  mountainTexture,
  type Sides,
  sameNeighborCount,
  shoreSides,
} from "../../ui/tiles/overworldVariants";
import type { TileName } from "../../ui/tiles/sources";
import type { DrawHandle, RectHandle } from "./sceneView";

/**
 * A positioned, keyed, texture-backed tile. `setSize` scales the sprite's
 * native atlas-frame pixels (8x8, ROG-68) up to the viewport's `tilePx` cell
 * size - without it a tile sprite renders at its own native 8px, leaving a
 * gap in every `tilePx`-sized cell instead of filling it (ROG-63).
 */
export interface SpriteHandle extends DrawHandle {
  setTexture(name: TileName): void;
  setSize(width: number, height: number): void;
  /** `0xffffff` (no tint) leaves the texture's own colors untouched. */
  setTint(color: number): void;
}

/** Renderer boundary this view draws through: sprites for tiles, rects for meter/minimap/shore chrome. */
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
/** Fraction of a tile cell a shore fringe strip occupies on a water tile's land-adjacent edge(s) (ROG-73). */
const SHORE_FRINGE_RATIO = 0.28;
/** Terrain that scales with same-type neighbor density instead of drawing at a fixed size (ROG-73). */
const DENSITY_SCALED_TILES = new Set<Tile>(["mountain", "forest"]);
/** Terrain that gets a small deterministic per-instance size variation instead of a fixed size (ROG-73). */
const LANDMARK_TILES = new Set<Tile>(["village", "dungeonEntrance"]);
const SHORE_SIDE_NAMES = ["north", "east", "south", "west"] as const;

/**
 * Draws the overworld's camera-follow tilemap, a whole-map minimap, and the
 * encounter meter, matching the TUI's layout intent (viewport + minimap side
 * by side, meter below) without depending on Ink's box model.
 */
export class OverworldSceneView {
  private readonly viewportSprites = new Map<string, SpriteHandle>();
  private readonly shoreRects = new Map<string, RectHandle>();
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
    const seenShoreRects = new Set<string>();
    const seenMinimapRects = new Set<string>();

    const viewportAreaWidth = Math.max(1, minimapBoxX - MINIMAP_GAP_PX);
    const viewportCols = Math.max(1, Math.floor(viewportAreaWidth / tilePx));
    const viewportRowsCount = Math.max(1, Math.floor(contentHeight / tilePx));
    const viewportRows = buildViewportRows(map, player, {
      width: viewportCols,
      height: viewportRowsCount,
    });
    // `viewportCols`/`viewportRowsCount` floor-divide, so a whole-tile
    // remainder is always left over unless the area happens to be an exact
    // multiple of `tilePx`. Split that remainder evenly on both edges
    // instead of dumping it as one dead strip on the right/bottom (ROG-66).
    const viewportOffsetX = Math.max(
      0,
      (viewportAreaWidth - viewportCols * tilePx) / 2,
    );
    const viewportOffsetY = Math.max(
      0,
      (contentHeight - viewportRowsCount * tilePx) / 2,
    );
    this.drawViewport(
      map,
      viewportRows,
      tilePx,
      viewportOffsetX,
      viewportOffsetY,
      seenSprites,
      seenShoreRects,
    );
    this.pruneStaleSprites(seenSprites);
    this.pruneStaleShoreRects(seenShoreRects);

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
    map: OverworldMap,
    rows: Cell[][],
    tilePx: number,
    offsetX: number,
    offsetY: number,
    seenSprites: Set<string>,
    seenShoreRects: Set<string>,
  ): void {
    for (const [rowIndex, row] of rows.entries()) {
      for (const [colIndex, cell] of row.entries()) {
        seenSprites.add(cell.key);
        let sprite = this.viewportSprites.get(cell.key);
        if (!sprite) {
          sprite = this.factory.createSprite();
          this.viewportSprites.set(cell.key, sprite);
        }
        const cellX = offsetX + colIndex * tilePx;
        const cellY = offsetY + rowIndex * tilePx;
        const displayTile = cell.tile ?? "grass";
        const terrain = map.tiles[cell.y]?.[cell.x];
        const isPlayer = displayTile === "player" || terrain === undefined;

        // Neighbor-density/position variant (ROG-73) - never for the
        // player's own marker, which always draws at a fixed texture/size.
        const texture = isPlayer
          ? displayTile
          : this.terrainTexture(map, terrain, cell.x, cell.y);
        sprite.setTexture(texture);
        // Minifantasy frames are full-color (ROG-68); no biome multiply-tint,
        // which was a hack for the old monochrome Urizen tiles.
        sprite.setTint(0xffffff);

        const scale = isPlayer
          ? 1
          : this.terrainScale(map, terrain, cell.x, cell.y);
        const size = tilePx * scale;
        sprite.setPosition(
          cellX - (size - tilePx) / 2,
          cellY - (size - tilePx) / 2,
        );
        sprite.setSize(size, size);

        this.drawShoreFringe(map, cell, cellX, cellY, tilePx, seenShoreRects);
      }
    }
  }

  /** Swaps `mountain` for a same-family, differently-sized crop by cluster density (ROG-73); every other terrain keeps its plain frame. */
  private terrainTexture(
    map: OverworldMap,
    terrain: Tile,
    x: number,
    y: number,
  ): TileName {
    if (terrain === "mountain") {
      return mountainTexture(sameNeighborCount(map, x, y, terrain));
    }
    return terrain;
  }

  /** Neighbor-density scale for mountain/forest, per-instance scale for village/dungeonEntrance, 1 otherwise. */
  private terrainScale(
    map: OverworldMap,
    terrain: Tile,
    x: number,
    y: number,
  ): number {
    if (DENSITY_SCALED_TILES.has(terrain)) {
      return clusterScale(sameNeighborCount(map, x, y, terrain));
    }
    if (LANDMARK_TILES.has(terrain)) {
      return landmarkScale(x, y);
    }
    return 1;
  }

  /** Draws a sand-tinted fringe rect on each land-adjacent side of a water tile (ROG-73's shore-edge stand-in). */
  private drawShoreFringe(
    map: OverworldMap,
    cell: Cell,
    cellX: number,
    cellY: number,
    tilePx: number,
    seen: Set<string>,
  ): void {
    const sides = shoreSides(map, cell.x, cell.y);
    const thickness = tilePx * SHORE_FRINGE_RATIO;
    for (const side of SHORE_SIDE_NAMES) {
      const key = `${cell.key}:shore:${side}`;
      if (!sides[side]) continue;
      seen.add(key);
      let rect = this.shoreRects.get(key);
      if (!rect) {
        rect = this.factory.createRect();
        this.shoreRects.set(key, rect);
      }
      rect.setColor(toPixiColor(theme.biome.shore));
      const [x, y, width, height] = this.shoreRectBounds(
        side,
        cellX,
        cellY,
        tilePx,
        thickness,
      );
      rect.setPosition(x, y);
      rect.setSize(width, height);
    }
  }

  private shoreRectBounds(
    side: keyof Sides,
    cellX: number,
    cellY: number,
    tilePx: number,
    thickness: number,
  ): [number, number, number, number] {
    switch (side) {
      case "north":
        return [cellX, cellY, tilePx, thickness];
      case "south":
        return [cellX, cellY + tilePx - thickness, tilePx, thickness];
      case "west":
        return [cellX, cellY, thickness, tilePx];
      case "east":
        return [cellX + tilePx - thickness, cellY, thickness, tilePx];
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

  private pruneStaleShoreRects(seen: Set<string>): void {
    for (const [key, rect] of this.shoreRects) {
      if (!seen.has(key)) {
        rect.destroy();
        this.shoreRects.delete(key);
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
