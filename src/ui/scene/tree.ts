import type { LogEntry } from "../../engine/state/types";
import type { Cell } from "../screens/overworld/render";

export type Unit = number;

export interface SceneNode {
  key: string;
}

export interface PanelNode extends SceneNode {
  kind: "panel";
  title?: string;
  children: AnyNode[];
}

export interface StackNode extends SceneNode {
  kind: "stack";
  direction: "row" | "column";
  gap?: Unit;
  children: AnyNode[];
}

export interface TextNode extends SceneNode {
  kind: "text";
  text: string;
  color: string;
  bold?: boolean;
}

export interface MeterNode extends SceneNode {
  kind: "meter";
  value: number;
  max: number;
  color: string;
  width: Unit;
}

export interface GridNode extends SceneNode {
  kind: "grid";
  rows: readonly Cell[][];
}

export interface SpriteNode extends SceneNode {
  kind: "sprite";

  tile?: string;
  fallback: { char: string; color: string };
  size: { width: Unit; height: Unit };
}

export interface MenuNode extends SceneNode {
  kind: "menu";
  items: readonly string[];
  selectedIndex: number;
  direction?: "row" | "column";
}

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
