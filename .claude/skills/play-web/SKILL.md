---
name: play-web
description: Play and screenshot the ts-rogue web game (the PixiJS browser renderer) like a real user. Use to see, craft, or verify the browser UI end-to-end: reproduce a visual bug, or check a web UI/behavior change. Runs the real Vite dev build in a headless browser and captures a screenshot.
---

# Playing the ts-rogue web UI

Drive the browser renderer through `scripts/play-web.mjs`. It's the web analogue
of `scripts/play.sh` (the terminal harness): same seed + keylog reproduction and
the same key-token vocabulary, but the game renders to a WebGL `<canvas>`, so a
"frame" is a real **screenshot** from a headless browser instead of a text
scrape. View it with the Read tool to see the UI.

Prerequisite: Playwright's chromium (`pnpm exec playwright install chromium`).
It's baked into the Eve sandbox at bootstrap.

## Loop

```bash
node scripts/play-web.mjs start 1    # boot Vite + a fresh deterministic run (seed 1)
node scripts/play-web.mjs shot       # screenshot -> prints a path; Read it
node scripts/play-web.mjs key <keys> # record key presses
node scripts/play-web.mjs shot       # screenshot again (replays the keys)
node scripts/play-web.mjs stop       # stop the Vite server
```

Each `shot` launches chromium, opens `/?seed=<seed>&fresh`, replays every key you
recorded, screenshots, and exits - so `key` just records intent and `shot` shows
the resulting state. Pass a path to keep a frame: `shot before.jpg`.
Add `--dev` to `start` to enable the in-game dev console (backtick toggles it).

`shot` captures a smaller 640x400 JPEG by default instead of a full-resolution
PNG at the session's configured viewport. A full-resolution PNG runs ~250KB,
which is ~100K tokens once base64-embedded by a caller without filesystem
access to this sandbox (the playtester subagent, for example); that single
shot was enough on its own to trip Eve's session token budget (HAR-77). The
default cuts a shot to well under a tenth of that size using Playwright's own
screenshot options, with no loss of legibility for pixel art. Pass
`shot --full` (writes `.png` by default) for the rare case that needs the
session's actual viewport resolution; an explicit `.png` path also selects a
lossless capture at whatever width and height `--full` would use.

## Keys

`key` takes the same tokens as the terminal harness. Special keys are named:
`Up Down Left Right Enter Escape Tab Space`. Everything else is a literal
character. Multiple tokens in one call are pressed in order:
`node scripts/play-web.mjs key Enter 3 j j o`.

Game controls (identical to the terminal - both renderers share the engine):
- **Any key** at the title advances into the game.
- **1 2 3 4** jump to village / overworld / dungeon / battle.
- **Arrows** or **w a s d** / **h j k l** move and turn (overworld: move;
  dungeon: turn + step forward/back).
- **o** open a chest, **>** or **Enter** descend stairs (dungeon).
- **`** (backtick) toggles the dev console (needs `--dev`); **q** quits.

## Determinism & repro

`start` resets to `--seed --fresh`, so the same seed plus the same key sequence
reproduces the same run exactly. `key` appends every keystroke to
`.play-web-keys.log` at the repo root; that log plus the seed is a complete
reproduction (same convention as the terminal `.play-keys.log`).
