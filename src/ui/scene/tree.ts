/**
 * Renderer-agnostic scene-tree node types (ROG-55 RFC, ROG-56 core).
 *
 * This module is pure data: no imports from `ink`, `pixi.js`, or `react`, and
 * no rendering logic. A future interpreter (Ink today, a Pixi/canvas renderer
 * later) walks an `AnyNode` tree and draws it; screens build the tree from
 * `GameState` and hand it to whichever interpreter is active. Nodes carry a
 * stable `key` so interpreters can key their own draw objects by identity
 * instead of diffing the tree themselves.
 *
 * `Unit` is deliberately abstract - it is not pixels or terminal columns.
 * Each interpreter defines what one unit means for its output medium.
 */

import type { LogEntry } from "../../engine/state/types";
import type { Cell } from "../screens/overworld/render";

/** Abstract layout unit; each interpreter defines what 1 unit means. */
export type Unit = number;

export interface SceneNode {
  /** Stable id across renders; interpreters key their draw objects by this instead of diffing the tree. */
  key: string;
}

/** A titled or untitled bordered container around child nodes. */
export interface PanelNode extends SceneNode {
  kind: "panel";
  title?: string;
  children: AnyNode[];
}

/** A row or column layout of child nodes with an optional gap between them. */
export interface StackNode extends SceneNode {
  kind: "stack";
  direction: "row" | "column";
  gap?: Unit;
  children: AnyNode[];
}

/** A run of styled text. */
export interface TextNode extends SceneNode {
  kind: "text";
  text: string;
  color: string; // a theme.ts hex value - this module doesn't import theme.ts, callers pass the token
  bold?: boolean;
}

/** A filled bar showing `value` out of `max` (HP/MP/XP bars, encounter meters). */
export interface MeterNode extends SceneNode {
  kind: "meter";
  value: number;
  max: number;
  color: string;
  width: Unit;
}

/** A fixed grid of glyph cells (map viewport, minimap). */
export interface GridNode extends SceneNode {
  kind: "grid";
  rows: readonly Cell[][]; // reuse the existing Cell type from screens/overworld/render.ts
}

/** A single tile/sprite, with an ASCII fallback for renderers without image support. */
export interface SpriteNode extends SceneNode {
  kind: "sprite";
  /** Atlas/tile frame name - same id space as TILE_SOURCES (src/ui/tiles/kitty.ts) and MonsterDef.sprite. */
  tile?: string;
  fallback: { char: string; color: string };
  size: { width: Unit; height: Unit };
}

/** A selectable list of items with a highlighted index. */
export interface MenuNode extends SceneNode {
  kind: "menu";
  items: readonly string[];
  selectedIndex: number;
  direction?: "row" | "column";
}

/** A scrolling message log, capped to the most recent `maxLines`. */
export interface LogNode extends SceneNode {
  kind: "log";
  messages: readonly LogEntry[];
  maxLines: number;
}

export type AnyNode =
  | PanelNode
  | StackNode
  | TextNode
  | MeterNode
  | GridNode
  | SpriteNode
  | MenuNode
  | LogNode;
