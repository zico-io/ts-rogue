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

export const UNIT_PX = 16;

export interface DrawHandle {
  setPosition(x: number, y: number): void;
  destroy(): void;
}

export interface RectHandle extends DrawHandle {
  setSize(width: number, height: number): void;
  setColor(color: number): void;
}

export interface TextHandle extends DrawHandle {
  setText(text: string): void;
  setColor(color: number): void;
  readonly width: number;
  readonly height: number;
}

export interface RectOptions {
  bevel?: boolean;

  gloss?: boolean;
}

export interface DrawFactory {
  createRect(options?: RectOptions): RectHandle;
  createText(initialText: string): TextHandle;
}

export interface ContentRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const ROW_HEIGHT_PX = UNIT_PX;

const METER_HEIGHT_PX = Math.round(UNIT_PX * 0.5);

const PANEL_PADDING_PX = UNIT_PX;

const BORDER_THICKNESS_PX = 3;

const TITLE_DIVIDER_HEIGHT_PX = 1;

const LOG_AGE_FADE_MAX = 0.35;

interface MeterHandles {
  background: RectHandle;
  fill: RectHandle;
}

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

    if (!this.border) this.border = this.factory.createRect();
    this.border.setPosition(0, 0);
    this.border.setSize(pixelSize.width, pixelSize.height);
    this.border.setColor(toPixiColor(theme.borderFocus));

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

      const age = visible.length > 1 ? 1 - index / (visible.length - 1) : 0;
      handle.setColor(
        mixColor(
          message.rarity
            ? theme.rarity[message.rarity]
            : theme.msg[message.kind],
          theme.window.fill,
          age * LOG_AGE_FADE_MAX,
        ),
      );
      handle.setPosition(x, y + index * ROW_HEIGHT_PX);
    }
    return Math.max(node.maxLines, visible.length) * ROW_HEIGHT_PX;
  }

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
