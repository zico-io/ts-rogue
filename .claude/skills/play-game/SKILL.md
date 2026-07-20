---
name: play-game
description: Play and observe the ts-rogue terminal game like a real user. Use when you need to see the running game, reproduce a gameplay bug, verify a UI/behavior change end-to-end, or drive the game step-by-step. Runs the real Ink app in a detached tmux session (real PTY, full color) and captures the screen.
---

# Playing ts-rogue

Drive the real game through `scripts/play.sh`, which runs it in a detached tmux
session (a real PTY: colors, raw input, the alternate screen) that persists
between calls, so you can send a key, look at the screen, and send the next key.

Prerequisite: tmux (`brew install tmux`). The harness prints how to install it if
missing.

## Loop

```bash
scripts/play.sh start 1      # boot a fresh, deterministic run (seed 1, 120x40)
scripts/play.sh frame        # look at the current screen (ANSI color)
scripts/play.sh key <keys>   # press keys
scripts/play.sh frame        # look again
scripts/play.sh stop         # end the session
```

After `start`, wait a moment before the first `frame` (Ink needs a beat to paint).
`frame --plain` drops color if the escape codes get in the way of reading.

## Keys

`scripts/play.sh key` forwards tmux key tokens. Special keys are named:
`Up Down Left Right Enter Escape Tab Space`. Everything else is a literal
character. Multiple tokens in one call are pressed in order:
`scripts/play.sh key Enter 3 j j o`.

Game controls:
- **Any key** at the title advances into the game.
- **1 2 3 4** jump to village / overworld / dungeon / battle.
- **Arrows** or **w a s d** / **h j k l** move and turn (overworld: move;
  dungeon: turn + step forward/back).
- **o** open a chest, **>** or **Enter** descend stairs (dungeon).
- **`** (backtick) toggles the dev console; **q** quits.

## Determinism & repro

`start` always boots with `--seed --fresh`, so the same seed plus the same key
sequence reproduces the same run exactly. `scripts/play.sh key` also appends every
keystroke to `.play-keys.log` at the repo root; that log plus the seed is a
complete reproduction, and the in-game dev-console `issue` command embeds both
into any Linear issue it files.

## Filing a bug you find

Open the dev console with backtick and run `issue <title>` (or `bug <title>`) to
create a Linear issue live, pre-filled with the seed, key sequence, current
state, message log, and the captured frame. Credentials are brokered by Vercel
Connect (needs `VERCEL_OIDC_TOKEN`; see README).
