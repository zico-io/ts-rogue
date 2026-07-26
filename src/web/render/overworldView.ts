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

export interface MultiCellRegion {
  col: number;
  row: number;
  wide: number;
  high: number;
}

export interface SpriteHandle extends DrawHandle {
  setTexture(name: TileName, region?: MultiCellRegion): void;
  setSize(width: number, height: number): void;

  setTint(color: number): void;
}

export interface BlobHandle extends DrawHandle {
  setSize(width: number, height: number): void;
  setColor(color: number): void;
  setAlpha(alpha: number): void;
}

export interface OverworldDrawFactory {
  createSprite(): SpriteHandle;
  createRect(): RectHandle;
  createBlob(): BlobHandle;
}

export interface PixelSize {
  width: number;
  height: number;
}

export interface DebugFootprintFixture {
  name: TileName;
  originCol: number;
  originRow: number;
}

const DEFAULT_TILE_PX = 24;

const MINIMAP_TILE_PX = 4;

const MINIMAP_PAD_PX = 6;
const MINIMAP_GAP_PX = 10;

const METER_HEIGHT_PX = 14;
const METER_GAP_PX = 10;

const SHORE_FRINGE_RATIO = 0.28;

const DENSITY_SCALED_TILES = new Set<Tile>(["mountain", "forest"]);

// Village renders its full 2x2 footprint as contiguous per-cell sprite
// regions (see landmarkRegion), so only single-cell landmarks get the
// organic per-tile scale jitter here.
const JITTERED_LANDMARK_TILES = new Set<Tile>(["dungeonEntrance"]);
const SHORE_SIDE_NAMES = ["north", "east", "south", "west"] as const;

const TAU = Math.PI * 2;

const SHADOW_TILES = new Set<Tile>([
  "mountain",
  "forest",
  "village",
  "dungeonEntrance",
]);
const SHADOW_ALPHA = 0.32;
const SHADOW_WIDTH_RATIO = 0.62;
const SHADOW_HEIGHT_RATIO = 0.26;

const PULSE_TILES = new Set<Tile>(["village", "dungeonEntrance"]);
const PULSE_PERIOD_MS = 1800;
const PULSE_MIN_ALPHA = 0.12;
const PULSE_MAX_ALPHA = 0.42;
const PULSE_SIZE_RATIO = 1.6;

const SHIMMER_DENSITY = 0.16;
const SHIMMER_PERIOD_MS = 1200;
const SHIMMER_MIN_ALPHA = 0.15;
const SHIMMER_MAX_ALPHA = 0.75;
const SHIMMER_SIZE_RATIO = 0.22;

const AMBIENT_POOL_SIZE = 12;
const LEAF_PX = 9;
const FIREFLY_PX = 5;
const LEAF_DRIFT_PX_PER_MS = 0.012;
const FIREFLY_DRIFT_PX_PER_MS = 0.006;

function hash01(a: number, b: number): number {
  const h = (Math.imul(a, 2654435761) ^ Math.imul(b, 2246822519)) >>> 0;
  return (h % 1000) / 1000;
}

export function needsPropShadow(
  tile: Tile | undefined,
  isPlayerMarker: boolean,
): boolean {
  if (isPlayerMarker) return true;
  return tile !== undefined && SHADOW_TILES.has(tile);
}

export function needsMarkerPulse(tile: Tile | undefined): boolean {
  return tile !== undefined && PULSE_TILES.has(tile);
}

export function isShimmerTile(x: number, y: number): boolean {
  return hash01(x * 92821 + 17, y * 31337 + 5) < SHIMMER_DENSITY;
}

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

interface MarkerPulse {
  handle: BlobHandle;
  color: number;
  phase: number;
}

interface WaterShimmer {
  handle: BlobHandle;
  phase: number;
}

interface AmbientParticle {
  handle: BlobHandle;
  kind: "leaf" | "firefly";
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

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

        const texture = isPlayer
          ? displayTile
          : this.terrainTexture(map, terrain, cell.x, cell.y);
        const region = isPlayer
          ? undefined
          : this.landmarkRegion(map, texture, cell.x, cell.y);
        // Only the footprint's top-left cell carries the ground shadow and
        // pulse halo, sized to the whole footprint, so a multi-tile landmark
        // reads as one prop instead of one per covered cell.
        const isFootprintAnchor =
          region === undefined || (region.col === 0 && region.row === 0);
        const footprintWide = region?.wide ?? 1;
        const footprintHigh = region?.high ?? 1;

        let shadow: BlobHandle | undefined;
        if (needsPropShadow(terrain, isPlayerMarker) && isFootprintAnchor) {
          seenShadows.add(cell.key);
          shadow = this.propShadows.get(cell.key);
          if (!shadow) {
            shadow = this.factory.createBlob();
            this.propShadows.set(cell.key, shadow);
          }
        }

        let pulse: MarkerPulse | undefined;
        if (
          !isPlayer &&
          terrain !== undefined &&
          needsMarkerPulse(terrain) &&
          isFootprintAnchor
        ) {
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

        sprite.setTexture(texture, region);

        sprite.setTint(0xffffff);

        const scale = isPlayer
          ? 1
          : region
            ? 1
            : this.terrainScale(map, terrain, cell.x, cell.y);
        const size = tilePx * scale;
        sprite.setPosition(
          cellX - (size - tilePx) / 2,
          cellY - (size - tilePx) / 2,
        );
        sprite.setSize(size, size);

        if (shadow) {
          const shadowWidth =
            tilePx * footprintWide * SHADOW_WIDTH_RATIO * scale;
          const shadowHeight =
            tilePx * footprintHigh * SHADOW_HEIGHT_RATIO * scale;
          shadow.setColor(toPixiColor(theme.background));
          shadow.setAlpha(SHADOW_ALPHA);
          shadow.setSize(shadowWidth, shadowHeight);
          shadow.setPosition(
            cellX + (tilePx * footprintWide - shadowWidth) / 2,
            cellY + tilePx * footprintHigh - shadowHeight * 0.85,
          );
        }

        if (pulse) {
          const pulseSize =
            Math.min(tilePx * footprintWide, tilePx * footprintHigh) *
            PULSE_SIZE_RATIO;
          pulse.handle.setColor(pulse.color);
          pulse.handle.setSize(pulseSize, pulseSize);
          pulse.handle.setPosition(
            cellX + (tilePx * footprintWide - pulseSize) / 2,
            cellY + (tilePx * footprintHigh - pulseSize) / 2,
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

  /**
   * The sub-region of a multi-cell landmark texture this map cell covers,
   * anchored at the landmark's top-left cell, or undefined for a single-cell
   * texture. Draws the footprint as one continuous sprite: one crop per
   * covered cell, contiguous and non-overlapping (ENG-7/ENG-8).
   */
  private landmarkRegion(
    map: OverworldMap,
    texture: TileName,
    x: number,
    y: number,
  ): MultiCellRegion | undefined {
    const { wide, high } = footprintOf(texture);
    if (wide <= 1 && high <= 1) return undefined;
    const anchor = texture === "village" ? map.village : undefined;
    if (!anchor) return undefined;
    const col = x - anchor.x;
    const row = y - anchor.y;
    if (col < 0 || col >= wide || row < 0 || row >= high) return undefined;
    return { col, row, wide, high };
  }

  private terrainScale(
    map: OverworldMap,
    terrain: Tile,
    x: number,
    y: number,
  ): number {
    if (DENSITY_SCALED_TILES.has(terrain)) {
      return clusterScale(sameNeighborCount(map, x, y, terrain));
    }
    if (JITTERED_LANDMARK_TILES.has(terrain)) {
      return landmarkScale(x, y);
    }
    return 1;
  }

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
