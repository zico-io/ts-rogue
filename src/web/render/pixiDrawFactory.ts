/**
 * Real Pixi implementation of `sceneView.ts`'s `DrawFactory`. Thin adapter
 * only - all layout/keying logic lives in `SceneChromeView`, which never
 * imports `pixi.js` so it stays unit-testable without a WebGL/canvas
 * context (see `sceneView.test.ts`). One factory is bound to a single Pixi
 * `Container` (one per scene, matching `main.ts`'s per-scene containers);
 * every rect/text it creates is added as that container's child.
 */

import { Graphics, Text } from "pixi.js";
import type { DrawFactory, RectHandle, TextHandle } from "./sceneView";

/** Builds a `DrawFactory` that adds every rect/text it creates to `container`. */
export function createPixiDrawFactory(container: {
  addChild(child: Graphics | Text): void;
}): DrawFactory {
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
    createText(initialText: string): TextHandle {
      const text = new Text({
        text: initialText,
        style: { fontFamily: "monospace", fontSize: 14 },
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
