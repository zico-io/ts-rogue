import type { KeyName } from "../../ui/scene/input";

export interface BrowserKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
}

export function normalizeBrowserKey(
  event: BrowserKeyEvent,
): KeyName | undefined {
  const key = event.key;
  if (event.ctrlKey && key.toLowerCase() === "c") return "ctrl+c";
  if (event.ctrlKey || event.metaKey) return undefined;
  switch (key) {
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    case "ArrowLeft":
      return "left";
    case "ArrowRight":
      return "right";
    case "Enter":
      return "enter";
    case "Escape":
      return "escape";
    case "Backspace":
    case "Delete":
      return "backspace";
    case "Tab":
      return "tab";
    default:
      break;
  }
  if (key === "`") return "`";
  if (key === "q") return "q";
  if (key === "h" || key === "j" || key === "k" || key === "l") return key;

  if (key.length !== 1) return undefined;
  if (/^[0-9]$/.test(key)) return `digit:${key}`;
  return `char:${key}`;
}
