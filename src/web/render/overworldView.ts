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
 *
 * `drawFootprint` (ENG-8) is the multi-cell texture mapping capability: it
 * places one sprite per grid cell covered by a texture's `multiCell`
 * footprint (`sources.ts`), each showing that cell's own sub-region, so the
 * whole texture reads as one continuous image across the footprint instead
 * of a single squished-and-rescaled sprite or tiled 1x1 repeats. `render`'s
 * optional `debugFixture` wires a dev-only demo of it into the real
 * viewport (see `bootGame.ts`'s `renderOverworldContent`); no live overworld
 * tile uses a multi-cell footprint yet - actually placing a landmark across
 * more than one map tile is ENG-7's job.
 *
 * Scene-level atmosphere (ROG-65) layers on top of the tilemap above, drawn
 * through a new `createBlob()` primitive (a filled ellipse - see
 * `BlobHandle`) rather than `createRect()`, so it never disturbs the
 * meter/minimap rect ordering `overworldView.test.ts` relies on:
 * - a soft drop-shadow blob under every prop tile (mountain/forest/village/
 *   dungeonEntrance) and the player marker, drawn *before* that cell's
 *   sprite is first created so it z-orders underneath it;
 * - a breathing glow halo behind village/dungeonEntrance markers, alpha
 *   oscillated by `tick(deltaMs)`;
 * - a sparse, deterministically hash-selected subset of visible water tiles
 *   get a small bright shimmer blob whose alpha pulses over time;
 * - a small fixed-size pool of screen-space ambient particles (leaves when
 *   forest is visible, firefly-like glints when grass/forest is visible)
 *   that drift/sway/loop within the viewport's pixel bounds, aged by `tick`.
 * This view stays framework-free and has no animation-frame source of its
 * own - `tick(deltaMs)` accumulates elapsed time and must be wired to a real
 * Pixi `Ticker` once by the caller (see `bootGame.ts`, mirroring
 * `battleView.ts`'s `tick`). `setReducedMotion(true)` freezes elapsed time
 * and clears the ambient particle pool outright, so drift fully stops
 * instead of just slowing (per `prefers-reduced-motion`, checked in
 * `bootGame.ts` since it's a DOM API this framework-free module never
 * touches). No `Math.random` anywhere - `hash01` (mirroring
 * `overworldVariants.ts`'s `positionHash`) gives every particle/shimmer/
 * pulse its per-instance phase/position variety deterministically, so a
 * given map+seed always renders (and animates from) the same state.
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
import {
  footprintCells,
  footprintOf,
  type TileName,
} from "../../ui/tiles/sources";
import type { DrawHandle, RectHandle } from "./sceneView";

/**
 * Which sub-region of a texture's natural multi-cell footprint one sprite
 * should show: the cell at `(col, row)` out of a `wide x high` grid, 0-based
 * from the footprint's top-left. Omitted (or `wide === high === 1`) means
 * "the whole texture", exactly as before ENG-8.
 */
export interface MultiCellRegion {
  col: number;
  row: number;
  wide: number;
  high: number;
}

/**
 * A positioned, keyed, texture-backed tile. `setSize` scales the sprite's
 * native atlas-frame pixels (8x8, ROG-68) up to the viewport's `tilePx` cell
 * size - without it a tile sprite renders at its own native 8px, leaving a
 * gap in every `tilePx`-sized cell instead of filling it (ROG-63).
 */
export interface SpriteHandle extends DrawHandle {
  setTexture(name: TileName, region?: MultiCellRegion): void;
  setSize(width: number, height: number): void;
  /** `0xffffff` (no tint) leaves the texture's own colors untouched. */
  setTint(color: number): void;
}

/**
 * A positioned, softer-edged draw primitive (a filled ellipse, not a rect)
 * used for every atmosphere effect (ROG-65): prop/player drop-shadows,
 * marker pulse halos, water shimmer glints, ambient leaf/firefly particles.
 * Kept distinct from `RectHandle` so atmosphere draws never land in the same
 * factory-call sequence `overworldView.test.ts` counts on for the meter's
 * background/fill rects (`factory.rects.at(-2)`/`.at(-1)`).
 */
export interface BlobHandle extends DrawHandle {
  setSize(width: number, height: number): void;
  setColor(color: number): void;
  setAlpha(alpha: number): void;
}

/** Renderer boundary this view draws through: sprites for tiles, rects for meter/minimap/shore chrome, blobs for atmosphere. */
export interface OverworldDrawFactory {
  createSprite(): SpriteHandle;
  createRect(): RectHandle;
  createBlob(): BlobHandle;
}

/** Pixel size of the region the view has to work with. */
export interface PixelSize {
  width: number;
  height: number;
}

/**
 * A dev-only multi-cell fixture placement (ENG-8), anchored at a
 * viewport-local (not map) grid position - purely a demonstration of the
 * texture-mapping capability, not a real map landmark (that's ENG-7).
 */
export interface DebugFootprintFixture {
  name: TileName;
  originCol: number;
  originRow: number;
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
/** Full turn in radians, used by every sine-based pulse/shimmer/twinkle animation. */
const TAU = Math.PI * 2;

// --- Atmosphere (ROG-65) ----------------------------------------------------

/** Terrain that gets a soft ground shadow blob under its sprite; the player marker always gets one too. */
const SHADOW_TILES = new Set<Tile>([
  "mountain",
  "forest",
  "village",
  "dungeonEntrance",
]);
const SHADOW_ALPHA = 0.32;
const SHADOW_WIDTH_RATIO = 0.62;
const SHADOW_HEIGHT_RATIO = 0.26;

/** Terrain that gets a breathing glow halo behind its marker. */
const PULSE_TILES = new Set<Tile>(["village", "dungeonEntrance"]);
const PULSE_PERIOD_MS = 1800;
const PULSE_MIN_ALPHA = 0.12;
const PULSE_MAX_ALPHA = 0.42;
const PULSE_SIZE_RATIO = 1.6;

/** Fraction of visible water tiles that get a shimmer glint. */
const SHIMMER_DENSITY = 0.16;
const SHIMMER_PERIOD_MS = 1200;
const SHIMMER_MIN_ALPHA = 0.15;
const SHIMMER_MAX_ALPHA = 0.75;
const SHIMMER_SIZE_RATIO = 0.22;

/** Fixed cap on the ambient leaf/firefly particle pool - decorative, not a simulation. */
const AMBIENT_POOL_SIZE = 12;
const LEAF_PX = 9;
const FIREFLY_PX = 5;
const LEAF_DRIFT_PX_PER_MS = 0.012;
const FIREFLY_DRIFT_PX_PER_MS = 0.006;

/** Deterministic unit-interval hash of two integers - never `Math.random` (keeps renders/animation reproducible), mirroring `overworldVariants.ts`'s `positionHash`. */
function hash01(a: number, b: number): number {
  const h = (Math.imul(a, 2654435761) ^ Math.imul(b, 2246822519)) >>> 0;
  return (h % 1000) / 1000;
}

/** True if `tile`/the player marker gets a ground-shadow blob (ROG-65). */
export function needsPropShadow(
  tile: Tile | undefined,
  isPlayerMarker: boolean,
): boolean {
  if (isPlayerMarker) return true;
  return tile !== undefined && SHADOW_TILES.has(tile);
}

/** True if `tile` gets a breathing glow halo (village/dungeonEntrance markers only). */
export function needsMarkerPulse(tile: Tile | undefined): boolean {
  return tile !== undefined && PULSE_TILES.has(tile);
}

/** Deterministic per-tile selection of the sparse water-shimmer subset (ROG-65). */
export function isShimmerTile(x: number, y: number): boolean {
  return hash01(x * 92821 + 17, y * 31337 + 5) < SHIMMER_DENSITY;
}

/**
 * Which ambient particle kind pool slot `index` gets for the current biome
 * mix - `undefined` when neither biome cue is visible (no ambient particles
 * at all). Both present alternates by index parity so the pool reads as a
 * mixed drift rather than segregated halves.
 */
export function ambientParticleKind(
  index: number,
  hasLeaves: boolean,
  hasFireflies: boolean,
): "leaf" | "firefly" | undefined {
  if (!hasLeaves && !hasFireflies) return undefined;
  if (hasLeaves && !hasFireflies) return "leaf";
  if (!hasLeaves && hasFireflies) return "firefly";
  return index % 2 === 0 ? "leaf" : "firefly";
}

/** A breathing glow halo drawn behind a village/dungeonEntrance marker. */
interface MarkerPulse {
  handle: BlobHandle;
  color: number;
  phase: number;
}

/** A sparse bright glint drawn over a water tile. */
interface WaterShimmer {
  handle: BlobHandle;
  phase: number;
}

/** One drifting screen-space leaf/firefly particle, wrapped within `viewportBounds`. */
interface AmbientParticle {
  handle: BlobHandle;
  kind: "leaf" | "firefly";
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
}

/** Pixel rect ambient particles drift/wrap within. */
interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Draws the overworld's camera-follow tilemap, a whole-map minimap, the
 * encounter meter, and the ROG-65 atmosphere layer (shadows/pulses/shimmer/
 * ambient particles), matching the TUI's layout intent (viewport + minimap
 * side by side, meter below) without depending on Ink's box model.
 */
export class OverworldSceneView {
  private readonly viewportSprites = new Map<string, SpriteHandle>();
  private readonly shoreRects = new Map<string, RectHandle>();
  private readonly minimapRects = new Map<string, RectHandle>();
  private minimapBorder: RectHandle | undefined;
  private meterBackground: RectHandle | undefined;
  private meterFill: RectHandle | undefined;

  private readonly propShadows = new Map<string, BlobHandle>();
  private readonly markerPulses = new Map<string, MarkerPulse>();
  private readonly waterShimmers = new Map<string, WaterShimmer>();
  private ambientParticles: AmbientParticle[] = [];
  private viewportBounds: Bounds = { x: 0, y: 0, width: 0, height: 0 };
  private elapsed = 0;
  private reducedMotion = false;

  constructor(private readonly factory: OverworldDrawFactory) {}

  /**
   * Renders one frame. `tilePx` is the pixel size of a main-viewport tile;
   * the minimap and meter size themselves off `pixelSize` independently.
   * `debugFixture` (ENG-8) is an optional dev-only multi-cell placement drawn
   * on top of the viewport, anchored at a viewport-local grid position.
   */
  render(
    state: GameState,
    map: OverworldMap,
    pixelSize: PixelSize,
    tilePx: number = DEFAULT_TILE_PX,
    debugFixture?: DebugFootprintFixture,
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
    const seenShadows = new Set<string>();
    const seenPulses = new Set<string>();
    const seenShimmers = new Set<string>();

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
    const biomeMix = this.drawViewport(
      map,
      viewportRows,
      tilePx,
      viewportOffsetX,
      viewportOffsetY,
      seenSprites,
      seenShoreRects,
      seenShadows,
      seenPulses,
      seenShimmers,
    );
    if (debugFixture) {
      // Drawn after the terrain loop above, so its sprites are later
      // container children and render on top - a multi-cell placement
      // needs to read as one continuous image, not be poked through by
      // whatever ordinary terrain sits underneath it.
      this.drawFootprint(
        debugFixture.name,
        debugFixture.originCol,
        debugFixture.originRow,
        viewportOffsetX,
        viewportOffsetY,
        tilePx,
        seenSprites,
      );
    }
    this.pruneStaleSprites(seenSprites);
    this.pruneStaleShoreRects(seenShoreRects);
    this.pruneStaleShadows(seenShadows);
    this.pruneStaleMarkerPulses(seenPulses);
    this.pruneStaleWaterShimmers(seenShimmers);

    this.viewportBounds = {
      x: viewportOffsetX,
      y: viewportOffsetY,
      width: viewportCols * tilePx,
      height: viewportRowsCount * tilePx,
    };
    this.syncAmbientParticles(biomeMix.hasLeaves, biomeMix.hasFireflies);

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

  /**
   * Ages every time-driven atmosphere effect one real animation frame:
   * marker pulse/water shimmer alpha oscillation, and ambient leaf/firefly
   * particle drift. Wire to a Pixi `Ticker` once (see `bootGame.ts`); a
   * no-op while `setReducedMotion(true)` is in effect, so "drift" fully
   * stops rather than just slowing.
   */
  tick(deltaMs: number): void {
    if (this.reducedMotion) return;
    this.elapsed += deltaMs;

    for (const pulse of this.markerPulses.values()) {
      const t =
        0.5 +
        0.5 * Math.sin((this.elapsed / PULSE_PERIOD_MS + pulse.phase) * TAU);
      pulse.handle.setAlpha(
        PULSE_MIN_ALPHA + (PULSE_MAX_ALPHA - PULSE_MIN_ALPHA) * t,
      );
    }

    for (const shimmer of this.waterShimmers.values()) {
      const t =
        0.5 +
        0.5 *
          Math.sin((this.elapsed / SHIMMER_PERIOD_MS + shimmer.phase) * TAU);
      shimmer.handle.setAlpha(
        SHIMMER_MIN_ALPHA + (SHIMMER_MAX_ALPHA - SHIMMER_MIN_ALPHA) * t,
      );
    }

    this.tickAmbientParticles(deltaMs);
  }

  /**
   * `prefers-reduced-motion` gate (checked in `bootGame.ts`, a DOM API this
   * framework-free module never touches directly). Freezes elapsed time
   * (so `tick` becomes a no-op) and destroys the ambient particle pool
   * outright rather than just parking it, so drift fully stops instead of
   * freezing mid-frame.
   */
  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    if (reduced) {
      this.elapsed = 0;
      for (const particle of this.ambientParticles) particle.handle.destroy();
      this.ambientParticles = [];
    }
  }

  private drawViewport(
    map: OverworldMap,
    rows: Cell[][],
    tilePx: number,
    offsetX: number,
    offsetY: number,
    seenSprites: Set<string>,
    seenShoreRects: Set<string>,
    seenShadows: Set<string>,
    seenPulses: Set<string>,
    seenShimmers: Set<string>,
  ): { hasLeaves: boolean; hasFireflies: boolean } {
    let hasForest = false;
    let hasGrassOrForest = false;

    for (const [rowIndex, row] of rows.entries()) {
      for (const [colIndex, cell] of row.entries()) {
        seenSprites.add(cell.key);
        const cellX = offsetX + colIndex * tilePx;
        const cellY = offsetY + rowIndex * tilePx;
        const displayTile = cell.tile ?? "grass";
        const terrain = map.tiles[cell.y]?.[cell.x];
        const isPlayerMarker = displayTile === "player";
        const isPlayer = isPlayerMarker || terrain === undefined;

        if (terrain === "forest") hasForest = true;
        if (terrain === "grass" || terrain === "forest") {
          hasGrassOrForest = true;
        }

        // Ground shadow first so it draws below this cell's sprite, which
        // is only true the first time this key is created - both this and
        // the sprite lookup below are keyed maps reused across renders, so
        // z-order is fixed at first-creation time (ROG-65).
        let shadow: BlobHandle | undefined;
        if (needsPropShadow(terrain, isPlayerMarker)) {
          seenShadows.add(cell.key);
          shadow = this.propShadows.get(cell.key);
          if (!shadow) {
            shadow = this.factory.createBlob();
            this.propShadows.set(cell.key, shadow);
          }
        }

        // Breathing glow halo behind village/dungeonEntrance markers, also
        // created before the sprite so the marker reads on top of its own
        // halo (ROG-65).
        let pulse: MarkerPulse | undefined;
        if (!isPlayer && terrain !== undefined && needsMarkerPulse(terrain)) {
          seenPulses.add(cell.key);
          pulse = this.markerPulses.get(cell.key);
          if (!pulse) {
            pulse = {
              handle: this.factory.createBlob(),
              color: toPixiColor(theme.biome[terrain]),
              phase: hash01(cell.x * 613 + 1, cell.y * 887 + 3),
            };
            this.markerPulses.set(cell.key, pulse);
          }
        }

        let sprite = this.viewportSprites.get(cell.key);
        if (!sprite) {
          sprite = this.factory.createSprite();
          this.viewportSprites.set(cell.key, sprite);
        }

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

        if (shadow) {
          const shadowWidth = tilePx * SHADOW_WIDTH_RATIO * scale;
          const shadowHeight = tilePx * SHADOW_HEIGHT_RATIO * scale;
          shadow.setColor(toPixiColor(theme.background));
          shadow.setAlpha(SHADOW_ALPHA);
          shadow.setSize(shadowWidth, shadowHeight);
          shadow.setPosition(
            cellX + (tilePx - shadowWidth) / 2,
            cellY + tilePx - shadowHeight * 0.85,
          );
        }

        if (pulse) {
          const pulseSize = tilePx * PULSE_SIZE_RATIO;
          pulse.handle.setColor(pulse.color);
          pulse.handle.setSize(pulseSize, pulseSize);
          pulse.handle.setPosition(
            cellX + (tilePx - pulseSize) / 2,
            cellY + (tilePx - pulseSize) / 2,
          );
        }

        if (terrain === "water" && isShimmerTile(cell.x, cell.y)) {
          seenShimmers.add(cell.key);
          let shimmer = this.waterShimmers.get(cell.key);
          if (!shimmer) {
            shimmer = {
              handle: this.factory.createBlob(),
              phase: hash01(cell.x * 419 + 7, cell.y * 733 + 11),
            };
            this.waterShimmers.set(cell.key, shimmer);
          }
          const shimmerSize = tilePx * SHIMMER_SIZE_RATIO;
          const offsetXFrac =
            0.25 + hash01(cell.x * 3 + 1, cell.y * 7 + 2) * 0.5;
          const offsetYFrac =
            0.25 + hash01(cell.x * 11 + 5, cell.y * 17 + 9) * 0.5;
          shimmer.handle.setColor(toPixiColor(theme.biome.shimmer));
          shimmer.handle.setSize(shimmerSize, shimmerSize);
          shimmer.handle.setPosition(
            cellX + tilePx * offsetXFrac - shimmerSize / 2,
            cellY + tilePx * offsetYFrac - shimmerSize / 2,
          );
        }

        this.drawShoreFringe(map, cell, cellX, cellY, tilePx, seenShoreRects);
      }
    }

    return { hasLeaves: hasForest, hasFireflies: hasGrassOrForest };
  }

  /**
   * Places one sprite per grid cell covered by `name`'s multi-cell footprint
   * (`sources.ts`'s `multiCell`), anchored with its top-left at viewport-local
   * grid `(originCol, originRow)`. Each sprite shows only its own sub-region
   * of the source texture (via `MultiCellRegion`), so the whole footprint
   * reads as one continuous image spanning `wide x high` cells instead of
   * `wide*high` repeats of the same 1x1 frame (ENG-8).
   */
  private drawFootprint(
    name: TileName,
    originCol: number,
    originRow: number,
    offsetX: number,
    offsetY: number,
    tilePx: number,
    seenSprites: Set<string>,
  ): void {
    const { wide, high } = footprintOf(name);
    for (const { col, row } of footprintCells(name)) {
      const key = `footprint:${name}:${col},${row}`;
      seenSprites.add(key);
      let sprite = this.viewportSprites.get(key);
      if (!sprite) {
        sprite = this.factory.createSprite();
        this.viewportSprites.set(key, sprite);
      }
      sprite.setTexture(name, { col, row, wide, high });
      sprite.setTint(0xffffff);
      sprite.setPosition(
        offsetX + (originCol + col) * tilePx,
        offsetY + (originRow + row) * tilePx,
      );
      sprite.setSize(tilePx, tilePx);
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

  private pruneStaleShadows(seen: Set<string>): void {
    for (const [key, shadow] of this.propShadows) {
      if (!seen.has(key)) {
        shadow.destroy();
        this.propShadows.delete(key);
      }
    }
  }

  private pruneStaleMarkerPulses(seen: Set<string>): void {
    for (const [key, pulse] of this.markerPulses) {
      if (!seen.has(key)) {
        pulse.handle.destroy();
        this.markerPulses.delete(key);
      }
    }
  }

  private pruneStaleWaterShimmers(seen: Set<string>): void {
    for (const [key, shimmer] of this.waterShimmers) {
      if (!seen.has(key)) {
        shimmer.handle.destroy();
        this.waterShimmers.delete(key);
      }
    }
  }

  /** Grows/shrinks the ambient particle pool to match the current biome mix, and restyles slots whose kind changed. */
  private syncAmbientParticles(
    hasLeaves: boolean,
    hasFireflies: boolean,
  ): void {
    if (this.reducedMotion) return;
    const desiredCount = hasLeaves || hasFireflies ? AMBIENT_POOL_SIZE : 0;

    while (this.ambientParticles.length > desiredCount) {
      const particle = this.ambientParticles.pop();
      particle?.handle.destroy();
    }
    while (this.ambientParticles.length < desiredCount) {
      const index = this.ambientParticles.length;
      this.ambientParticles.push(
        this.spawnAmbientParticle(index, hasLeaves, hasFireflies),
      );
    }

    for (const [index, particle] of this.ambientParticles.entries()) {
      const kind = ambientParticleKind(index, hasLeaves, hasFireflies);
      if (kind && kind !== particle.kind) {
        particle.kind = kind;
        this.styleAmbientParticle(particle);
      }
    }
  }

  private spawnAmbientParticle(
    index: number,
    hasLeaves: boolean,
    hasFireflies: boolean,
  ): AmbientParticle {
    const kind = ambientParticleKind(index, hasLeaves, hasFireflies) ?? "leaf";
    const bounds = this.viewportBounds;
    const width = Math.max(1, bounds.width);
    const height = Math.max(1, bounds.height);
    const speed =
      kind === "leaf" ? LEAF_DRIFT_PX_PER_MS : FIREFLY_DRIFT_PX_PER_MS;
    const angle = hash01(index * 5 + 2, index * 17 + 3) * TAU;
    const particle: AmbientParticle = {
      handle: this.factory.createBlob(),
      kind,
      x: bounds.x + hash01(index * 13 + 1, 7) * width,
      y: bounds.y + hash01(3, index * 29 + 11) * height,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed * 0.4 + speed * 0.3,
      phase: hash01(index * 31 + 1, index * 41 + 2),
    };
    this.styleAmbientParticle(particle);
    return particle;
  }

  private styleAmbientParticle(particle: AmbientParticle): void {
    const size = particle.kind === "leaf" ? LEAF_PX : FIREFLY_PX;
    particle.handle.setSize(size, size);
    particle.handle.setColor(
      toPixiColor(
        particle.kind === "leaf" ? theme.biome.leaf : theme.biome.firefly,
      ),
    );
  }

  /** Drifts/sways every pooled particle and wraps it back into `viewportBounds`. */
  private tickAmbientParticles(deltaMs: number): void {
    const bounds = this.viewportBounds;
    const width = Math.max(1, bounds.width);
    const height = Math.max(1, bounds.height);
    for (const particle of this.ambientParticles) {
      particle.x += particle.vx * deltaMs;
      particle.y += particle.vy * deltaMs;
      const sway =
        Math.sin(this.elapsed / 600 + particle.phase * TAU) *
        (particle.kind === "leaf" ? 6 : 3);
      const wrappedX =
        bounds.x + ((((particle.x - bounds.x) % width) + width) % width);
      const wrappedY =
        bounds.y + ((((particle.y - bounds.y) % height) + height) % height);
      particle.handle.setPosition(wrappedX + sway, wrappedY);

      const twinkle =
        particle.kind === "firefly"
          ? 0.4 +
            0.6 *
              (0.5 + 0.5 * Math.sin(this.elapsed / 500 + particle.phase * TAU))
          : 0.55;
      particle.handle.setAlpha(twinkle);
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
