import type { Key } from "ink";
import type { KeyName } from "../scene/input";

export function normalizeInkKey(input: string, key: Key): KeyName | undefined {
  if (key.ctrl && input === "c") return "ctrl+c";
  if (key.ctrl || key.meta) return undefined;
  if (key.upArrow) return "up";
  if (key.downArrow) return "down";
  if (key.leftArrow) return "left";
  if (key.rightArrow) return "right";
  if (key.return) return "enter";
  if (key.escape) return "escape";
  if (key.backspace || key.delete) return "backspace";
  if (key.tab) return "tab";
  if (input === "`") return "`";
  if (input === "q") return "q";
  if (input === "h" || input === "j" || input === "k" || input === "l") {
    return input;
  }
  if (!input) return undefined;
  if (/^[0-9]$/.test(input)) return `digit:${input}`;
  return `char:${input}`;
}
