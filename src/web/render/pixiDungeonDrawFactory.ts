import {
  Graphics,
  type ParticleContainer,
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
import type { ParticleHandle } from "./particles";
import { createPixiParticleDrawFactory } from "./pixiParticleDrawFactory";
import type { RectHandle, TextHandle } from "./sceneView";

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

    texture.source.scaleMode = "nearest";
    textures.push(texture);
  }
  return textures;
}

export function createPixiDungeonDrawFactory(
  container: { addChild(child: Sprite | Graphics | Text): void },
  sheet: Spritesheet,
  particleContainer: ParticleContainer,
): DungeonDrawFactory {
  const wallTexelTextures = buildWallTexelTextures(sheet);
  const particles = createPixiParticleDrawFactory(particleContainer);

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
          applySize();
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
    createParticle(): ParticleHandle {
      return particles.createParticle();
    },
  };
}
