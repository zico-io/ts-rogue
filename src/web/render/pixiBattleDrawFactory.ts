/**
 * Real Pixi implementation of `battleView.ts`'s `BattleDrawFactory`. Thin
 * adapter only, mirroring `pixiOverworldDrawFactory.ts`'s split - all layout,
 * keying, and turn-feedback logic lives in `BattleSceneView`, which never
 * imports `pixi.js` so it stays unit-testable without a WebGL/canvas context
 * (see `battleView.test.ts`). One factory is bound to a single Pixi
 * `Container` and looks enemy sprite textures up by name from a loaded atlas
 * `Spritesheet` (`atlas.ts`'s `loadAtlas()`).
 */

import { Graphics, Sprite, type Spritesheet, Text } from "pixi.js";
import type {
  BattleDrawFactory,
  BattleRectHandle,
  BattleSpriteHandle,
  BattleTextHandle,
} from "./battleView";

/** Builds a `BattleDrawFactory` whose sprites/rects/text are all children of `container`. */
export function createPixiBattleDrawFactory(
  container: { addChild(child: Sprite | Graphics | Text): void },
  sheet: Spritesheet,
): BattleDrawFactory {
  return {
    hasTexture(name: string): boolean {
      return name in sheet.textures;
    },
    createSprite(): BattleSpriteHandle {
      const sprite = new Sprite();
      container.addChild(sprite);
      return {
        setPosition(x: number, y: number) {
          sprite.position.set(x, y);
        },
        setTexture(name: string) {
          const texture = sheet.textures[name];
          if (sprite.texture !== texture) {
            sprite.texture = texture;
            // Atlas tiles are native 12x12 pixel art (see `README.md`'s Art
            // pipeline section); nearest-neighbor keeps upscaling crisp.
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
    createRect(): BattleRectHandle {
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
    createText(initialText: string): BattleTextHandle {
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
        setAlpha(alpha: number) {
          text.alpha = alpha;
        },
        get width() {
          return text.width;
        },
        destroy() {
          text.destroy();
        },
      };
    },
  };
}
