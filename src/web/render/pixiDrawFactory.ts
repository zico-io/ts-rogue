/**
 * Real Pixi implementation of `sceneView.ts`'s `DrawFactory`. Thin adapter
 * only - all layout/keying logic lives in `SceneChromeView`, which never
 * imports `pixi.js` so it stays unit-testable without a WebGL/canvas
 * context (see `sceneView.test.ts`). One factory is bound to a single Pixi
 * `Container` (one per scene, matching `main.ts`'s per-scene containers);
 * every rect/text it creates is added as that container's child.
 *
 * Rects (ROG-64, art direction §5) can opt into a beveled 3D look - a
 * lighter top/left edge and a darker bottom/right edge derived from the
 * rect's own fill color - and a top gloss line, so the same primitive draws
 * both the windowskin panel and the HP/MP meters without hand-coding a fixed
 * bevel palette that would mismatch a meter's dynamic hp/mp color.
 * Text uses the HUD bitmap font (`font.ts`) once it's installed, falling
 * back to a plain canvas `Text` in `monospace` until then (or forever, if
 * the font failed to load) so the HUD never blocks on it.
 */

import { BitmapText, Graphics, Text } from "pixi.js";
import { HUD_FONT_FAMILY, HUD_FONT_SIZE, isHudFontReady } from "../font";
import type { DrawFactory, RectHandle, TextHandle } from "./sceneView";

/** Lightens (`amount` > 0) or darkens (`amount` < 0) a packed `0xRRGGBB` color by blending each channel toward white/black. */
function shade(color: number, amount: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const target = amount >= 0 ? 255 : 0;
  const t = Math.min(1, Math.abs(amount));
  const mix = (channel: number) => Math.round(channel + (target - channel) * t);
  return (mix(r) << 16) | (mix(g) << 8) | mix(b);
}

export interface RectOptions {
  /** Draws a lighter top/left edge and a darker bottom/right edge, derived from the fill color. */
  bevel?: boolean;
  /** Draws a translucent white band across the rect's top portion, on top of any bevel. */
  gloss?: boolean;
}

/** Builds a `DrawFactory` that adds every rect/text it creates to `container`. */
export function createPixiDrawFactory(container: {
  addChild(child: Graphics | Text | BitmapText): void;
}): DrawFactory {
  return {
    createRect(options: RectOptions = {}): RectHandle {
      const { bevel = false, gloss = false } = options;
      const graphics = new Graphics();
      container.addChild(graphics);
      let width = 0;
      let height = 0;
      let color = 0x000000;
      const redraw = () => {
        graphics.clear();
        graphics.rect(0, 0, width, height).fill(color);
        if (bevel && width > 1 && height > 1) {
          const thickness = Math.max(
            1,
            Math.min(2, Math.floor(Math.min(width, height) / 6)),
          );
          const light = shade(color, 0.35);
          const dark = shade(color, -0.35);
          graphics.rect(0, 0, width, thickness).fill(light); // top
          graphics.rect(0, 0, thickness, height).fill(light); // left
          graphics.rect(0, height - thickness, width, thickness).fill(dark); // bottom
          graphics.rect(width - thickness, 0, thickness, height).fill(dark); // right
        }
        if (gloss && width > 1 && height > 2) {
          const glossHeight = Math.max(1, Math.round(height * 0.4));
          graphics
            .rect(0, 0, width, glossHeight)
            .fill({ color: 0xffffff, alpha: 0.22 });
        }
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
    createText(initialText: string): TextHandle {
      const text = isHudFontReady()
        ? new BitmapText({
            text: initialText,
            style: { fontFamily: HUD_FONT_FAMILY, fontSize: HUD_FONT_SIZE },
          })
        : new Text({
            text: initialText,
            style: { fontFamily: "monospace", fontSize: HUD_FONT_SIZE },
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
        destroy() {
          text.destroy();
        },
        get width() {
          return text.width;
        },
        get height() {
          return text.height;
        },
      };
    },
  };
}
