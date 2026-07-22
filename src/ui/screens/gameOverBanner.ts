/**
 * Pure display data for the game-over screen: the block-letter banner. No
 * Ink/React import, so the browser renderer (`src/web/main.ts`, ROG-52) can
 * reuse it without pulling in Ink's terminal-only dependency tree.
 * `GameOverScreen.tsx` re-exports this for its existing importers.
 */
export const BANNER = [
  " ████  ███  █   █ █████      ███  █   █ █████ ████",
  "█     █   █ ██ ██ █         █   █ █   █ █     █   █",
  "█  ██ █████ █ █ █ ███       █   █ █   █ ███   ████",
  "█   █ █   █ █   █ █         █   █  █ █  █     █  █",
  " ███  █   █ █   █ █████      ███    █   █████ █   █",
];
