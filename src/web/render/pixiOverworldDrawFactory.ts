import {
  Graphics,
  Rectangle,
  Sprite,
  type Spritesheet,
  Texture,
} from "pixi.js";
import type { TileName } from "../../ui/tiles/sources";
import type {
  BlobHandle,
  MultiCellRegion,
  OverworldDrawFactory,
  SpriteHandle,
} from "./overworldView";
import type { RectHandle } from "./sceneView";

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

              sprite.texture.source.scaleMode = "nearest";
            }
            return;
          }

          sprite.texture = subTexture(sheet.textures[name], region);
          sprite.texture.source.scaleMode = "nearest";
        },
        setSize(width: number, height: number) {
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
