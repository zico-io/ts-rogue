# Web terminal

The browser plays the **real game**. There is no second renderer: `server.ts`
runs the Ink terminal app (`src/app.tsx`) in a PTY and streams its bytes to
[wterm](https://github.com/vercel-labs/wterm) in the browser.

```
browser                     server.ts (Node)
+---------------------+     +-------------------------+
| <Terminal>  (wterm) |     | WebSocketServer         |
|   DOM rows, WASM VT |<--->|   /api/terminal         |
+---------------------+ ws  |     |                   |
                            |   node-pty -> tsx src/app.tsx
                            +-------------------------+
```

wterm renders to real DOM rows rather than a canvas, so browser-native text
selection, copy/paste, find, and screen readers work on the game screen.

## Running

```bash
pnpm web:dev
```

Query params mirror the CLI flags, so a browser run reproduces a terminal run:

| Param | Terminal equivalent |
| --- | --- |
| `?seed=123` | `--seed=123` |
| `?fresh` | `--fresh` |
| `?dev` | `--dev` |

`?seed=1&fresh` in the browser is the same run as
`pnpm game:dev --seed=1 --fresh` in a terminal.

## Wire protocol

The protocol is the seam. The client never learns what is on the other end, so
the PTY can move to a Vercel Sandbox (or anywhere else) without touching
`app/GameTerminal.tsx`.

- **client -> server**: JSON, two message types only.
  `{"t":"i","d":"<keystrokes>"}` and `{"t":"r","cols":N,"rows":N}`.
- **server -> client**: raw PTY bytes, unframed. wterm writes them through.

Query params become process arguments, so `gameArgs` validates them at the
server boundary: a seed that is not a safe integer is dropped rather than
passed on.

## Files

- `server.ts` - Next.js custom server: `next()` + `createServer` + a
  `WebSocketServer` on `/api/terminal`. Every existing Next route still goes
  through `app.getRequestHandler()`.
- `session.ts` - `GameSession`: one long-lived game process that browser
  sockets attach to and detach from. Closing the tab leaves the game running
  for 10 minutes so a reload lands back in the same run; after that it is sent
  SIGTERM and autosaves. Integration-tested in `session.test.ts`.
- `pty-server.ts` - the host that runs inside a player's Vercel Sandbox: one
  `GameSession`, a health GET, a `?token=` check. `scripts/bundle.ts` bundles
  it with the game; `scripts/snapshot.ts` turns that into the sandbox image.
- `lib/sandbox.ts`, `app/api/session/` - find or create the player's sandbox
  from the cookie token and hand the browser its WebSocket URL.
- `app/GameTerminal.tsx` - the client. Draws the game's logo as a splash, then
  connects in `onReady`, never earlier:
  writes before wterm's WASM grid exists are dropped, and by then `autoResize`
  has settled, so the game boots straight into the real size instead of
  starting at 80x24 and redrawing.
- `app/page.tsx`, `app/globals.css` - the page chrome framing the terminal.
- `lib/harness/`, `app/api/harness/` - eve agent-run observability. Unrelated
  to the game.

## Deployment

The page is a normal Next.js deploy. The game is not: each player gets a
persistent Vercel Sandbox running `pty-server`, found by the `tsr_token`
cookie, resumed from its snapshot when they come back and stopped ten minutes
after they leave. Ship a new game image with `pnpm bundle && pnpm snapshot`
and set the printed `GAME_SNAPSHOT_ID` on the Vercel project. Design and the
Kubernetes fallback: `.mex/context/web-play-scaling.md`.

## Terminal fidelity

wterm's default core (~12 KB) covers what Ink emits: alternate screen, 24-bit
color, box drawing, wide Unicode. `@wterm/ghostty` (~400 KB) is the upgrade
path if the game ever needs graphemes, images, or full VT compliance - pass it
as the `core` prop.

- The game gets a minimal environment, never `process.env`. Inheriting the
  server's environment leaked server secrets into a browser-driven process and
  passed `CI` through - Ink stops rendering incrementally when it detects CI
  and buffers until exit, so an interactive game that never exits drew a
  permanently blank terminal with no error. A consequence: `?dev` cannot reach
  Linear credentials.

`node-pty` is pinned to `1.2.0-beta.15`: the `1.1.0` release publishes
`spawn-helper` without the executable bit, so every spawn fails with
`posix_spawnp failed` on macOS and Linux.
