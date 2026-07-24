/**
 * Pixi interpreter (ROG-47) for the shared HUD chrome tree `buildChrome`
 * (`src/ui/scene/chrome.ts`) produces. Walks the same `PanelNode` the Ink
 * interpreter (`src/ui/components/Screen.tsx`) walks, and draws it with
 * whatever `DrawFactory` it's given - real Pixi `Graphics`/`Text` in
 * `main.ts` (see `createPixiDrawFactory` in `pixiDrawFactory.ts`), or a fake
 * in tests, the same way `SceneView` in `../scenes.ts` lets `SceneSwitcher`
 * run without a real Pixi container.
 *
 * Draw objects are kept in maps keyed by `node.key` and reused across
 * `render()` calls - a text/meter/log-line's handle is created once and
 * mutated in place on every subsequent render, so a dispatch that only
 * changes HP doesn't tear down and rebuild the whole chrome. Keys no longer
 * present after a render (e.g. a party member who left, or a log line that
 * scrolled out) are destroyed at the end of that render.
 *
 * `Unit` here is atlas-scaled pixels: `UNIT_PX` is how many real pixels one
 * chrome unit occupies, so `buildChrome` (which only ever sees `Unit`, never
 * raw pixels) is handed a size pre-divided by `UNIT_PX` and never itself
 * knows about pixels.
 */

import type { GameState } from "../../engine/state/types";
import { buildChrome, type ChromeOptions } from "../../ui/scene/chrome";
import type {
  AnyNode,
  LogNode,
  MeterNode,
  StackNode,
  TextNode,
} from "../../ui/scene/tree";
import { theme, toPixiColor } from "../../ui/theme";

/** Real pixels per chrome `Unit`. Chosen to read clearly at the atlas's native 8x8 tile scale (ROG-68), not tied to any specific font metric. */
export const UNIT_PX = 16;

/** A positioned, destroyable draw primitive; every handle kind extends this. */
export interface DrawHandle {
  setPosition(x: number, y: number): void;
  destroy(): void;
}

/** A solid rectangle - panel border, meter background/fill. */
export interface RectHandle extends DrawHandle {
  setSize(width: number, height: number): void;
  setColor(color: number): void;
}

/** A run of text; `width`/`height` are the rendered size in pixels, used for row layout. */
export interface TextHandle extends DrawHandle {
  setText(text: string): void;
  setColor(color: number): void;
  readonly width: number;
  readonly height: number;
}

/** Optional decoration a `RectHandle` can draw around its own fill color - see `pixiDrawFactory.ts`. */
export interface RectOptions {
  /** Lighter top/left edge + darker bottom/right edge, derived from the fill color (ROG-64 windowskin bevel). */
  bevel?: boolean;
  /** Translucent white band across the top portion, for the meter fill's gloss line. */
  gloss?: boolean;
}

/** Renderer boundary: produces the draw primitives `SceneChromeView` positions and mutates. */
export interface DrawFactory {
  createRect(options?: RectOptions): RectHandle;
  createText(initialText: string): TextHandle;
}

/** Pixel rect of the scene's content region, the Pixi analog of `useScreenContent`'s `ScreenContent`. */
export interface ContentRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Row height in pixels; every text/meter row occupies exactly one, mirroring one terminal line. */
const ROW_HEIGHT_PX = UNIT_PX;
/** Meter bar height in pixels, shorter than a full row so its row's text baseline still reads clearly. */
const METER_HEIGHT_PX = Math.round(UNIT_PX * 0.5);
/** Left/right and top padding inside the panel border, matching the Ink interpreter's `paddingX`. */
const PANEL_PADDING_PX = UNIT_PX;
/**
 * Thickness of the visible border line. The Ink interpreter's border is a
 * real outline (one terminal cell's worth of box-drawing characters) with
 * the terminal's own implicit black behind it; the Pixi border rect below
 * is a full-bleed fill instead (no stroke API on `RectHandle`), so a second,
 * inset `background` rect covers everything but this margin - otherwise
 * every pixel a scene's content doesn't cover reads as the border's amber
 * frame color instead of the navy `window` fill the windowskin implies
 * (ROG-63/ROG-64).
 */
const BORDER_THICKNESS_PX = 3;
/** Thickness of the hairline separating the title row from the body, part of the ROG-64 typography pass. */
const TITLE_DIVIDER_HEIGHT_PX = 1;
/** How far a log line's per-kind color fades toward the window fill by the time it's the oldest visible line (ROG-64). */
const LOG_AGE_FADE_MAX = 0.35;

/** One HP/MP meter's two rect handles. */
interface MeterHandles {
  background: RectHandle;
  fill: RectHandle;
}

/** Blends `hex` toward `towardHex` by `amount` (0 = `hex` unchanged, 1 = fully `towardHex`), packed as a Pixi color int. */
function mixColor(hex: string, towardHex: string, amount: number): number {
  const from = toPixiColor(hex);
  const to = toPixiColor(towardHex);
  const t = Math.max(0, Math.min(1, amount));
  const mix = (shift: number) => {
    const a = (from >> shift) & 0xff;
    const b = (to >> shift) & 0xff;
    return Math.round(a + (b - a) * t);
  };
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

/**
 * Draws the shared HUD chrome tree with real graphical meters (replacing the
 * terminal's `█`/`░` glyph bars) and keeps every draw object keyed by
 * `node.key` for cheap incremental updates across renders.
 */
export class SceneChromeView {
  private border: RectHandle | undefined;
  private background: RectHandle | undefined;
  private titleDivider: RectHandle | undefined;
  private title: TextHandle | undefined;
  private readonly texts = new Map<string, TextHandle>();
  private readonly meters = new Map<string, MeterHandles>();
  private readonly logLines = new Map<string, TextHandle>();
  private seenTextKeys = new Set<string>();
  private seenMeterKeys = new Set<string>();
  private seenLogKeys = new Set<string>();

  constructor(private readonly factory: DrawFactory) {}

  /** Rebuilds/updates the chrome for `state` at `pixelSize`, returning the content region rect. */
  render(
    state: GameState,
    pixelSize: { width: number; height: number },
    opts: ChromeOptions,
  ): ContentRect {
    const unitSize = {
      width: pixelSize.width / UNIT_PX,
      height: pixelSize.height / UNIT_PX,
    };
    const { panel, content } = buildChrome(state, unitSize, opts);

    this.seenTextKeys = new Set();
    this.seenMeterKeys = new Set();
    this.seenLogKeys = new Set();

    // Amber windowskin frame (ROG-64, art direction §5) - the outer ring
    // `background` insets away from, replacing the old flat indigo border.
    if (!this.border) this.border = this.factory.createRect();
    this.border.setPosition(0, 0);
    this.border.setSize(pixelSize.width, pixelSize.height);
    this.border.setColor(toPixiColor(theme.borderFocus));

    // The navy window body itself, beveled so it reads as a lit console
    // panel rather than a flat fill.
    if (!this.background)
      this.background = this.factory.createRect({ bevel: true });
    this.background.setPosition(BORDER_THICKNESS_PX, BORDER_THICKNESS_PX);
    this.background.setSize(
      Math.max(0, pixelSize.width - BORDER_THICKNESS_PX * 2),
      Math.max(0, pixelSize.height - BORDER_THICKNESS_PX * 2),
    );
    this.background.setColor(toPixiColor(theme.window.fill));

    if (!this.title) this.title = this.factory.createText(panel.title ?? "");
    this.title.setText(panel.title ?? "");
    this.title.setColor(toPixiColor(theme.title));
    this.title.setPosition(PANEL_PADDING_PX, 0);

    // Hairline separating the title from the body - a small typography/
    // hierarchy cue (ROG-64) that fits inside the title row's existing
    // height budget, so it never perturbs `buildChrome`'s row math.
    if (!this.titleDivider) this.titleDivider = this.factory.createRect();
    this.titleDivider.setPosition(
      PANEL_PADDING_PX,
      ROW_HEIGHT_PX - TITLE_DIVIDER_HEIGHT_PX,
    );
    this.titleDivider.setSize(
      Math.max(0, content.width * UNIT_PX),
      TITLE_DIVIDER_HEIGHT_PX,
    );
    this.titleDivider.setColor(toPixiColor(theme.borderFocus));

    const contentRect: ContentRect = {
      x: PANEL_PADDING_PX,
      y: ROW_HEIGHT_PX,
      width: content.width * UNIT_PX,
      height: content.height * UNIT_PX,
    };

    let cursorY = contentRect.y + contentRect.height;
    for (const child of panel.children) {
      cursorY += this.layoutColumn(child, PANEL_PADDING_PX, cursorY);
    }

    this.pruneStale();
    return contentRect;
  }

  /** Positions one panel-level child and returns the pixel height it consumed. */
  private layoutColumn(node: AnyNode, x: number, y: number): number {
    switch (node.kind) {
      case "stack":
        if (node.direction === "row") {
          this.layoutRow(node, x, y);
          return ROW_HEIGHT_PX;
        }
        return this.layoutStackColumn(node, x, y);
      case "text":
        this.drawText(node, x, y);
        return ROW_HEIGHT_PX;
      case "meter":
        this.drawMeter(node, x, y);
        return ROW_HEIGHT_PX;
      case "log":
        return this.drawLog(node, x, y);
      case "panel":
        return this.layoutStackColumn(
          {
            key: node.key,
            kind: "stack",
            direction: "column",
            children: node.children,
          },
          x,
          y,
        );
      default:
        // grid/sprite/menu: not produced by buildChrome; scene content
        // renders outside this tree, in the content rect.
        return 0;
    }
  }

  private layoutStackColumn(node: StackNode, x: number, y: number): number {
    let cursorY = y;
    for (const child of node.children) {
      cursorY += this.layoutColumn(child, x, cursorY);
    }
    return cursorY - y;
  }

  /** Lays out a row's leaf children (text/meter) left to right using each one's rendered width. */
  private layoutRow(node: StackNode, x: number, y: number): void {
    let cursorX = x;
    for (const child of node.children) {
      if (child.kind === "text") {
        const handle = this.drawText(child, cursorX, y);
        cursorX += handle.width;
      } else if (child.kind === "meter") {
        const width = this.drawMeter(child, cursorX, y);
        cursorX += width;
      }
      // row children are text/meter only in the trees buildChrome produces.
    }
  }

  private drawText(node: TextNode, x: number, y: number): TextHandle {
    this.seenTextKeys.add(node.key);
    let handle = this.texts.get(node.key);
    if (!handle) {
      handle = this.factory.createText(node.text);
      this.texts.set(node.key, handle);
    }
    handle.setText(node.text);
    handle.setColor(toPixiColor(node.color));
    handle.setPosition(x, y);
    return handle;
  }

  /** Draws a background/fill meter pair and returns the pixel width it occupies. */
  private drawMeter(node: MeterNode, x: number, y: number): number {
    this.seenMeterKeys.add(node.key);
    let handles = this.meters.get(node.key);
    if (!handles) {
      handles = {
        background: this.factory.createRect({ bevel: true }),
        fill: this.factory.createRect({ bevel: true, gloss: true }),
      };
      this.meters.set(node.key, handles);
    }
    const widthPx = node.width * UNIT_PX;
    const ratio =
      node.max > 0 ? Math.max(0, Math.min(1, node.value / node.max)) : 0;
    handles.background.setPosition(
      x,
      y + (ROW_HEIGHT_PX - METER_HEIGHT_PX) / 2,
    );
    handles.background.setSize(widthPx, METER_HEIGHT_PX);
    handles.background.setColor(toPixiColor(theme.textFaint));
    handles.fill.setPosition(x, y + (ROW_HEIGHT_PX - METER_HEIGHT_PX) / 2);
    handles.fill.setSize(widthPx * ratio, METER_HEIGHT_PX);
    handles.fill.setColor(toPixiColor(node.color));
    return widthPx;
  }

  /** Draws the tail of the log's messages as one text line per visible message. Returns pixel height consumed. */
  private drawLog(node: LogNode, x: number, y: number): number {
    const start = Math.max(0, node.messages.length - node.maxLines);
    const visible = node.messages.slice(start);
    for (let index = 0; index < visible.length; index += 1) {
      const message = visible[index];
      const key = `${node.key}-${start + index}`;
      this.seenLogKeys.add(key);
      let handle = this.logLines.get(key);
      if (!handle) {
        handle = this.factory.createText(message.text);
        this.logLines.set(key, handle);
      }
      handle.setText(message.text);
      // Faint age-fade (ROG-64): the oldest visible line fades toward the
      // window fill, the newest stays at full color, so the log reads as a
      // stream rather than a wall of same-weight text.
      const age = visible.length > 1 ? 1 - index / (visible.length - 1) : 0;
      handle.setColor(
        mixColor(
          theme.msg[message.kind],
          theme.window.fill,
          age * LOG_AGE_FADE_MAX,
        ),
      );
      handle.setPosition(x, y + index * ROW_HEIGHT_PX);
    }
    return Math.max(node.maxLines, visible.length) * ROW_HEIGHT_PX;
  }

  /** Destroys draw handles for keys not touched by the most recent `render()`. */
  private pruneStale(): void {
    for (const [key, handle] of this.texts) {
      if (!this.seenTextKeys.has(key)) {
        handle.destroy();
        this.texts.delete(key);
      }
    }
    for (const [key, handles] of this.meters) {
      if (!this.seenMeterKeys.has(key)) {
        handles.background.destroy();
        handles.fill.destroy();
        this.meters.delete(key);
      }
    }
    for (const [key, handle] of this.logLines) {
      if (!this.seenLogKeys.has(key)) {
        handle.destroy();
        this.logLines.delete(key);
      }
    }
  }
}
