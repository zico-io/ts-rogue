import type { KeyName } from "../../ui/scene/input";

/**
 * The subset of `KeyboardEvent` `normalizeBrowserKey` reads. A real DOM
 * `KeyboardEvent` satisfies this structurally, but the narrower shape lets
 * this module (and its tests) run in plain Node/vitest, where the global
 * `KeyboardEvent` constructor doesn't exist (this repo's vitest config runs
 * in Node, not jsdom - see `boot.test.ts`/`scenes.test.ts`).
 */
export interface BrowserKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
}

/**
 * Normalizes a browser `KeyboardEvent` to the same renderer-agnostic
 * `KeyName` alphabet `normalizeInkKey` produces for Ink (ROG-45), so every
 * screen's `Keymap`/`resolveXIntent` runs unchanged under either renderer.
 * Ctrl/meta-modified keys other than Ctrl-C are dropped (`undefined`),
 * mirroring `normalizeInkKey`'s guard against typing modified keys into a
 * text buffer.
 */
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
  // Everything else that isn't a single printable character (Shift, Control,
  // F-keys, arrows already handled above, etc.) has no representable KeyName.
  if (key.length !== 1) return undefined;
  if (/^[0-9]$/.test(key)) return `digit:${key}`;
  return `char:${key}`;
}
