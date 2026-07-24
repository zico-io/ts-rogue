/**
 * Pure display data for the title flow (ROG-56; extracted further in ROG-52).
 * The block-letter logo, main-menu entries, and hero-name length cap have no
 * Ink/React dependency, so both `title/interaction.ts` (a renderer-agnostic
 * reducer) and the browser renderer (`src/web/main.ts`) can depend on this
 * data directly without pulling in Ink's terminal-only dependency tree.
 * `TitleScreen.tsx` re-exports all of this for its existing importers.
 */

/** Block-letter logo, one gradient color per row (see `theme.logoGradient`). */
export const LOGO = [
  "█████  ████       ████   ███   ████ █   █ █████",
  "  █   █           █   █ █   █ █     █   █ █",
  "  █    ███   ███  ████  █   █ █  ██ █   █ ███",
  "  █       █       █  █  █   █ █   █ █   █ █",
  "  █   ████        █   █  ███   ███   ███  █████",
];

/** Which title view is showing; input for all of these lives in `app.tsx` (Ink) or `main.ts` (browser). */
export type TitleView = "menu" | "class" | "mode" | "name" | "settings";

/** A main-menu entry. `id` drives the branch in `app.tsx`/`main.ts`. */
export interface MenuOption {
  id: "new" | "continue" | "settings" | "quit";
  label: string;
}

/** Main-menu entries; `Continue` only appears when a save exists. */
export function mainMenuOptions(hasSave: boolean): readonly MenuOption[] {
  return [
    { id: "new", label: "New Game" },
    ...(hasSave ? ([{ id: "continue", label: "Continue" }] as const) : []),
    { id: "settings", label: "Settings" },
    { id: "quit", label: "Quit" },
  ];
}

/** Max hero-name length; keeps the `PartyBar` HUD footer aligned. */
export const MAX_NAME_LENGTH = 12;
