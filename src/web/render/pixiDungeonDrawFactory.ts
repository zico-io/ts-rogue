/**
 * Real Pixi implementation of `dungeonView.ts`'s `DungeonDrawFactory`. Thin
 * adapter only, mirroring `pixiOverworldDrawFactory.ts`'s split - all layout,
 * keying, and raycast-to-draw-call logic lives in `DungeonSceneView`, which
 * never imports `pixi.js` so it stays unit-testable without a WebGL/canvas
 * context (see `dungeonView.test.ts`).
 *
 * The one Pixi-specific trick here: per-column wall texturing needs a
 * distinct 1-texel-wide horizontal slice of the `wall` atlas frame per
 * `TEXELS_PER_TILE` texel index, so a wall face reads as a real texture
 * instead of `TEXELS_PER_TILE` squished copies of the whole tile. Pixi's
 * `Texture` supports an arbitrary `frame` rectangle into a shared `source`,
 * so `buildWallTexelTextures` crops the wall frame into its
 * `TEXELS_PER_TILE` (native tile width) 1px-wide columns once at setup time -
 * never per frame - and `createWallColumn`'s `setTexel` just swaps between
 * those cached textures.
 */

import {
  Graphics,
  Rectangle,
  Sprite,
  type Spritesheet,
  Text,
  Texture,
} from "pixi.js";
import { TEXELS_PER_TILE } from "./dungeonRaycast";
import type {
  BillboardSpriteHandle,
  DungeonDrawFactory,
  WallColumnHandle,
} from "./dungeonView";
import type { RectHandle, TextHandle } from "./sceneView";

/** Crops the wall atlas frame into `TEXELS_PER_TILE` 1-texel-wide sub-textures, cached once. */
function buildWallTexelTextures(sheet: Spritesheet): Texture[] {
  const wallTexture = sheet.textures.wall;
  const frame = wallTexture.frame;
  const texelWidth = frame.width / TEXELS_PER_TILE;
  const textures: Texture[] = [];
  for (let texel = 0; texel < TEXELS_PER_TILE; texel++) {
    const texture = new Texture({
      source: wallTexture.source,
      frame: new Rectangle(
        frame.x + texel * texelWidth,
        frame.y,
        texelWidth,
        frame.height,
      ),
    });
    // Each cropped `Texture` wraps the same shared atlas source `atlas.ts`'s
    // `loadAtlas()` already sets to nearest-neighbor; defensive no-op here.
    texture.source.scaleMode = "nearest";
    textures.push(texture);
  }
  return textures;
}

/** Builds a `DungeonDrawFactory` whose sprites/rects/text are all children of `container`. */
export function createPixiDungeonDrawFactory(
  container: { addChild(child: Sprite | Graphics | Text): void },
  sheet: Spritesheet,
): DungeonDrawFactory {
  const wallTexelTextures = buildWallTexelTextures(sheet);

  return {
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
    createWallColumn(): WallColumnHandle {
      const sprite = new Sprite(wallTexelTextures[0]);
      container.addChild(sprite);
      let width = 0;
      let height = 0;
      const applySize = () => {
        sprite.width = width;
        sprite.height = height;
      };
      return {
        setPosition(x: number, y: number) {
          sprite.position.set(x, y);
        },
        setSize(w: number, h: number) {
          width = w;
          height = h;
          applySize();
        },
        setTexel(texel: number) {
          sprite.texture = wallTexelTextures[texel] ?? wallTexelTextures[0];
          applySize(); // Pixi resets width/height when the texture changes.
        },
        setTint(color: number) {
          sprite.tint = color;
        },
        destroy() {
          sprite.destroy();
        },
      };
    },
    createBillboardSprite(): BillboardSpriteHandle {
      const sprite = new Sprite();
      container.addChild(sprite);
      return {
        setPosition(x: number, y: number) {
          sprite.position.set(x, y);
        },
        setSize(size: number) {
          sprite.width = size;
          sprite.height = size;
        },
        setTexture(name: string) {
          const texture = sheet.textures[name];
          if (texture && sprite.texture !== texture) {
            sprite.texture = texture;
            // `atlas.ts`'s `loadAtlas()` already sets this on the shared
            // texture source; defensive no-op here (ROG-63).
            sprite.texture.source.scaleMode = "nearest";
          }
        },
        setTint(color: number) {
          sprite.tint = color;
        },
        destroy() {
          sprite.destroy();
        },
      };
    },
    createText(initialText: string): TextHandle {
      const text = new Text({
        text: initialText,
        style: { fill: 0xffffff, fontSize: 14, fontFamily: "monospace" },
      });
      container.addChild(text);
      return {
        setPosition(x: number, y: number) {
          text.position.set(x, y);
        },
        setText(value: string) {
          text.text = value;
        },
        setColor(color: number) {
          text.style.fill = color;
        },
        get width() {
          return text.width;
        },
        get height() {
          return text.height;
        },
        destroy() {
          text.destroy();
        },
      };
    },
  };
}
