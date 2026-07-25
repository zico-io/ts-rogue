/**
 * Real Pixi implementation of `overworldView.ts`'s `OverworldDrawFactory`.
 * Thin adapter only, mirroring `pixiDrawFactory.ts`'s split - all layout and
 * keying logic lives in `OverworldSceneView`, which never imports `pixi.js`
 * so it stays unit-testable without a WebGL/canvas context (see
 * `overworldView.test.ts`). One factory is bound to a single Pixi
 * `Container` and looks tile textures up by name from a loaded atlas
 * `Spritesheet` (`atlas.ts`'s `loadAtlas()`).
 */

import {
  Graphics,
  Rectangle,
  Sprite,
  type Spritesheet,
  Texture,
} from "pixi.js";
import type { TileName } from "../../ui/tiles/sources";
import type {
  MultiCellRegion,
  BlobHandle,
  OverworldDrawFactory,
  SpriteHandle,
} from "./overworldView";
import type { RectHandle } from "./sceneView";

/**
 * A frame's atlas rect already isolates its own pixels via Pixi's
 * `Texture.frame`; a multi-cell texture (ENG-8) is packed at its natural
 * `wide*8 x high*8` size instead of squished to one cell (`sources.ts`'s
 * `multiCell`, `scripts/build-atlas.ts`), so this subdivides that rect into
 * `region.wide x region.high` even slices and returns the one sub-region at
 * `region.col, region.row` - what makes one covered grid cell show its own
 * slice instead of the whole (unsquished) texture. Not cached: only debug/
 * landmark fixtures use multi-cell regions today, nowhere near per-frame-
 * sensitive volume; cache by `${name}:${col}:${row}` if that changes
 * (ponytail).
 */
function subTexture(base: Texture, region: MultiCellRegion): Texture {
  const subWidth = base.frame.width / region.wide;
  const subHeight = base.frame.height / region.high;
  const frame = new Rectangle(
    base.frame.x + region.col * subWidth,
    base.frame.y + region.row * subHeight,
    subWidth,
    subHeight,
  );
  return new Texture({ source: base.source, frame });
}

/** Builds an `OverworldDrawFactory` whose sprites/rects/blobs are all children of `container`. */
export function createPixiOverworldDrawFactory(
  container: { addChild(child: Sprite | Graphics): void },
  sheet: Spritesheet,
): OverworldDrawFactory {
  return {
    createSprite(): SpriteHandle {
      const sprite = new Sprite();
      container.addChild(sprite);
      return {
        setPosition(x: number, y: number) {
          sprite.position.set(x, y);
        },
        setTexture(name: TileName, region?: MultiCellRegion) {
          const isMultiCell =
            region !== undefined && (region.wide > 1 || region.high > 1);
          if (!isMultiCell) {
            const texture = sheet.textures[name];
            if (sprite.texture !== texture) {
              sprite.texture = texture;
              // Atlas tiles are native 8x8 pixel art (ART_DIRECTION.md
              // §2.1); `atlas.ts`'s `loadAtlas()` already sets this on the
              // shared texture source, so this is a defensive no-op
              // (ROG-63).
              sprite.texture.source.scaleMode = "nearest";
            }
            return;
          }
          // A multi-cell region's sub-texture is a fresh object every call
          // (see `subTexture`'s doc comment), so there is no cheap identity
          // check to skip the reassignment here.
          sprite.texture = subTexture(sheet.textures[name], region);
          sprite.texture.source.scaleMode = "nearest";
        },
        setSize(width: number, height: number) {
          // Scales the native 8x8 atlas frame up to the viewport's tile
          // cell (an integer factor at the current `OVERWORLD_TILE_PX`, so
          // texels stay square) - without this the sprite renders at its
          // own native size and leaves a gap in the cell (ROG-63).
          sprite.width = width;
          sprite.height = height;
        },
        setTint(color: number) {
          sprite.tint = color;
        },
        destroy() {
          sprite.destroy();
        },
      };
    },
    createRect(): RectHandle {
      const graphics = new Graphics();
      container.addChild(graphics);
      let width = 0;
      let height = 0;
      let color = 0x000000;
      const redraw = () => {
        graphics.clear();
        graphics.rect(0, 0, width, height).fill(color);
      };
      return {
        setPosition(x: number, y: number) {
          graphics.position.set(x, y);
        },
        setSize(w: number, h: number) {
          width = w;
          height = h;
          redraw();
        },
        setColor(c: number) {
          color = c;
          redraw();
        },
        destroy() {
          graphics.destroy();
        },
      };
    },
    createBlob(): BlobHandle {
      // A filled ellipse, not a rect - soft-edged enough at tile scale to
      // read as a shadow/glow/glint without needing a blur filter (ROG-65).
      const graphics = new Graphics();
      container.addChild(graphics);
      let width = 0;
      let height = 0;
      let color = 0x000000;
      let alpha = 1;
      const redraw = () => {
        graphics.clear();
        const rx = width / 2;
        const ry = height / 2;
        graphics.ellipse(rx, ry, rx, ry).fill({ color, alpha });
      };
      return {
        setPosition(x: number, y: number) {
          graphics.position.set(x, y);
        },
        setSize(w: number, h: number) {
          width = w;
          height = h;
          redraw();
        },
        setColor(c: number) {
          color = c;
          redraw();
        },
        setAlpha(a: number) {
          alpha = a;
          redraw();
        },
        destroy() {
          graphics.destroy();
        },
      };
    },
  };
}
