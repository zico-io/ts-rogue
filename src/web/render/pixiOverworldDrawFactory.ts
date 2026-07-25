/**
 * Real Pixi implementation of `overworldView.ts`'s `OverworldDrawFactory`.
 * Thin adapter only, mirroring `pixiDrawFactory.ts`'s split - all layout and
 * keying logic lives in `OverworldSceneView`, which never imports `pixi.js`
 * so it stays unit-testable without a WebGL/canvas context (see
 * `overworldView.test.ts`). One factory is bound to a single Pixi
 * `Container` and looks tile textures up by name from a loaded atlas
 * `Spritesheet` (`atlas.ts`'s `loadAtlas()`).
 */

import { Graphics, Sprite, type Spritesheet } from "pixi.js";
import type { TileName } from "../../ui/tiles/sources";
import type {
  BlobHandle,
  OverworldDrawFactory,
  SpriteHandle,
} from "./overworldView";
import type { RectHandle } from "./sceneView";

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
        setTexture(name: TileName) {
          const texture = sheet.textures[name];
          if (sprite.texture !== texture) {
            sprite.texture = texture;
            // Atlas tiles are native 8x8 pixel art (ART_DIRECTION.md §2.1);
            // `atlas.ts`'s `loadAtlas()` already sets this on the shared
            // texture source, so this is a defensive no-op (ROG-63).
            sprite.texture.source.scaleMode = "nearest";
          }
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
