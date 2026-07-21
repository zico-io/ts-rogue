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
