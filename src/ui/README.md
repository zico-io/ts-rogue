# Terminal UI

The Ink UI renders `GameState`, dispatches engine events, and owns terminal and
external I/O.

## Runtime flow

`src/app.tsx` loads a save or creates a seeded run, then routes the title,
village, overworld, dungeon, battle, game-over, crash, and developer-console
screens. Gameplay scenes share `components/Screen.tsx`, which owns the bordered
frame, party status, controls hint, and message log.

The layout responds to terminal resize events. Below 64 columns by 24 rows it
shows a minimum-size message. Pure render helpers size maps, first-person
dungeon geometry, and enemy layouts from the available content region.

## Visual identity

All color lives in [`theme.ts`](theme.ts) as semantic tokens over the game's
64-swatch palette (ROG-31). Components consume tokens, never raw color strings.
Ink passes hex through chalk, which downsamples for 256- and 16-color
terminals; there is no capability-detection code.

| Token | Hex | Role |
| --- | --- | --- |
| `text` / `textMuted` / `textFaint` | `#f2f2da` / `#a59b9d` / `#706a80` | Text hierarchy: primary, hints, disabled/dead |
| `border` / `borderFocus` / `title` | `#444f8d` / `#e3aa3e` / `#c6b4b1` | Panel chrome; gold border marks the active floating panel |
| `accent` | `#e3aa3e` | Cursors, selection, the acting hero |
| `danger` / `warn` / `heal` | `#e74343` / `#f8a64c` / `#5fae3b` | HP states (≤25% / ≤50% / healthy), errors |
| `mp` / `gold` | `#23b4e9` / `#fbc254` | MP meter, currency |
| `msg.*` | damage `#fa7d66`, loot `#fbc254`, quest `#ca7ef2`, system `#837d83` | Log line color by `LogEntry.kind`; the newest damage line renders bold |
| `rarity.*` | common `#c6b4b1`, magic `#1793e6`, rare `#fee284`, unique `#ca7ef2` | Item rarity everywhere items appear |
| `biome.*` | grass `#5fae3b`, forest `#21804c`, mountain `#837d83`, water `#23b4e9`, village `#fbc254`, entrance `#ca7ef2` | Overworld tiles |
| `DUNGEON_RAMPS` | teal / indigo / ember, 4 steps each | First-person depth bands per dungeon, far-dim to near-bright |

Monster art carries its own accent (`MonsterDef.color`); the title logo and
game-over banner use the `logoGradient` / `gameOverGradient` ramps.

Do: pick the existing semantic token for what the element *means*; keep one
accent per region; treat dim colors as hierarchy, not decoration. Don't: put
raw color strings in components; add hexes outside `theme.ts`; use bold for
non-interactive text (bold marks selection and the damage flash). When adding a
dark token, check it survives 16 colors (`new Chalk({level: 1}).hex(...)`) —
pure darks downsample to invisible ANSI black; that is why `border` and
`textFaint` lean blue.

## Controls

| Context | Controls |
| --- | --- |
| Global | `q` or Ctrl+C exits; backtick switches the developer console in dev mode |
| New game | Up/Down and Enter select a class, then Normal or Permadeath mode; Esc returns to class selection |
| Village | Up/Down and Enter select; `i`, `c`, `s`, `o` open buildings or leave; Esc returns |
| Overworld | Arrows or `h`, `j`, `k`, `l` move; Esc returns to the village |
| Dungeon | Arrows, WASD, or HJKL move and turn; `o` opens; Enter or `>` descends; `<` exits |
| Battle | Up/Down selects an action; Enter confirms; Esc cancels targeting |

The store view uses Tab to switch between shop and backpack modes. Backpack
actions equip, unequip, compare, and sell generated items.

The class selection offers Warrior, Rogue, and Wizard. Battle skill menus show
only the selected class's known skills, and restarting after permadeath keeps
the same class and mode.

## Diagnostics

`pnpm game:dev` enables a console that can inspect state, scenes, logs, and the
debug journal; file Linear issues; flush queued reports; and deliberately test
the failure path. Vercel Connect supplies Linear credentials when
`VERCEL_OIDC_TOKEN` is present in `.env.local`. `LINEAR_TEAM_KEY` overrides the
default `ROG` team.

Failed dev reports remain in `dev-issues.jsonl` for retry. Production play does
not contact Linear and writes incidents to `game-incidents.jsonl`.

Use `pnpm play start [seed] [cols] [rows]` to exercise the real UI in tmux, then
send input with `pnpm play key` and inspect it with `pnpm play frame`. Run UI
logic and renderer tests with `pnpm test:unit`.

Engine behavior is documented in [`../engine/README.md`](../engine/README.md).
