import { Graphics, Sprite, Text, type Texture } from "pixi.js";
import type {
  BattleDrawFactory,
  BattleRectHandle,
  BattleSpriteHandle,
  BattleTextHandle,
} from "./battleView";

export function createPixiBattleDrawFactory(
  container: { addChild(child: Sprite | Graphics | Text): void },
  textures: Record<string, Texture>,
): BattleDrawFactory {
  return {
    hasTexture(name: string): boolean {
      return name in textures;
    },
    createSprite(): BattleSpriteHandle {
      const sprite = new Sprite();

      sprite.anchor.set(0.5);
      container.addChild(sprite);
      let boxX = 0;
      let boxY = 0;
      let boxWidth = 0;
      let boxHeight = 0;

      const layout = () => {
        sprite.position.set(boxX + boxWidth / 2, boxY + boxHeight / 2);
        const nativeWidth = sprite.texture.width;
        const nativeHeight = sprite.texture.height;
        if (
          boxWidth <= 0 ||
          boxHeight <= 0 ||
          nativeWidth <= 0 ||
          nativeHeight <= 0
        ) {
          return;
        }
        const scale = Math.min(
          boxWidth / nativeWidth,
          boxHeight / nativeHeight,
        );

        sprite.width = Math.round(nativeWidth * scale);
        sprite.height = Math.round(nativeHeight * scale);
      };
      return {
        setPosition(x: number, y: number) {
          boxX = x;
          boxY = y;
          layout();
        },
        setTexture(name: string) {
          const texture = textures[name];
          if (sprite.texture !== texture) {
            sprite.texture = texture;

            sprite.texture.source.scaleMode = "nearest";
          }
          layout();
        },
        setSize(width: number, height: number) {
          boxWidth = width;
          boxHeight = height;
          layout();
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
