---
name: web-renderer
description: The web terminal - how the browser plays the real Ink game over a WebSocket-attached PTY using wterm. Load when touching src/web.
triggers:
  - "web"
  - "browser"
  - "terminal"
  - "wterm"
  - "pty"
  - "websocket"
  - "next.js"
  - "server.ts"
last_updated: 2026-09-09
---

# Web terminal

`src/web` (`@ts-rogue/web`) does **not** re-implement the game. It runs the Ink
terminal app in a PTY and streams the bytes to a terminal emulator in the
browser, so the web build and the CLI are the same program by construction.

```
browser                     server.ts (Node)
+---------------------+     +-------------------------+
| <Terminal>  (wterm) |     | WebSocketServer         |
|   DOM rows, WASM VT |<--->|   /api/terminal         |
+---------------------+ ws  |   node-pty -> tsx src/app.tsx
                            +-------------------------+
```

[wterm](https://github.com/vercel-labs/wterm) (`@wterm/react`, `@wterm/dom`) is
a Zig/WASM VT emulator that renders real DOM rows, so browser-native selection,
copy/paste, find, and screen readers work on the game screen. It is only the
client half: it has no server package, and running a real program is our PTY.

## Wire protocol is the seam

The client never learns what is on the other end, so the PTY can move to a
Vercel Sandbox without touching `app/GameTerminal.tsx`. There is deliberately
no `PtyBackend` interface - the protocol is the abstraction.

- **client -> server**: JSON, two message types.
  `{"t":"i","d":"<keystrokes>"}` and `{"t":"r","cols":N,"rows":N}`.
- **server -> client**: raw PTY bytes, unframed.

## Files

- `server.ts` - local dev only: Next custom server plus a `WebSocketServer` on
  `/api/terminal`, one `GameSession` per distinct query string (so a reload
  reattaches, like production). Runs the game as `tsx src/app.tsx`.
- `session.ts` - `GameSession`: one long-lived game process that sockets attach
  to and detach from. Closing the tab does not kill the game; it waits
  `detachTtlMs` (10 min) for a reattach, then SIGTERMs it so it autosaves.
  The last attach wins, the previous socket gets close code 4000. On attach it
  shrinks the PTY by one column and grows it back, because Ink only repaints a
  blank screen when the width shrinks. `gameArgs` validates query params **at
  the boundary** because they become process arguments.
- `pty-server.ts` - the host that runs inside a player's sandbox: one
  `GameSession`, a `/health` GET, `?token=` check. Bundled by `pnpm bundle`.
- `lib/sandbox.ts`, `app/api/session/route.ts` - find or create the player's
  sandbox by cookie token, start pty-server if it is not answering, return the
  wss URL. `app/api/session/stopped/route.ts` is what pty-server calls on exit
  so the VM stops now instead of at its timeout.
- `app/GameTerminal.tsx` - draws the game's own logo as a splash before
  connecting, connects in `onReady`, reconnects with backoff, and every
  attempt asks `/api/session` again so a stopped sandbox is simply restarted.
- `scripts/bundle.ts` - esbuild: `dist/app.js`, `dist/pty-server.js`, node-pty,
  and `dist/VERSION` (content hash). Runs as part of `pnpm build`.
  `scripts/snapshot.ts` - uploads node-pty into a sandbox and snapshots it; the
  game files are uploaded per sandbox by the session route when VERSION differs.

## Query params mirror CLI flags

`?seed=123`, `?fresh`, `?dev` map to `--seed=123`, `--fresh`, `--dev`, so
`?seed=1&fresh` in the browser is the same run as
`pnpm game:dev --seed=1 --fresh`. They apply to every game start while that
URL is open, including the automatic restart after a quit, so `?fresh` in the
address bar keeps skipping the save until it is removed. That equivalence is the point of this design
and is the fastest way to check a browser bug is not browser-specific.

## Gotchas

- `node-pty` is pinned to `1.2.0-beta.15`. The `1.1.0` release publishes
  `spawn-helper` without the executable bit, so every spawn fails with
  `posix_spawnp failed` on macOS and Linux.
- `node-pty` needs `allowBuilds: node-pty: true` in `pnpm-workspace.yaml`;
  without it pnpm skips the postinstall and the binding is unusable.
- The game gets a minimal environment, never `process.env`: that leaked server
  secrets into a browser-driven process, and passing `CI` through made Ink
  buffer instead of render, so the terminal stayed blank forever. `?dev`
  therefore cannot reach Linear credentials.
- Ink's `MinSizeGuard` needs 64x24. Below that the game itself renders
  "Terminal too small", which is correct behaviour, not a bug.

## Deployment

Vercel project `ts-rogue-web` (team gargoyle, Root Directory `src/web`). The
game does not run in a Function: each player gets a Vercel Sandbox, see
[[web-play-scaling]]. Ship a new game image with:

```
pnpm --filter @ts-rogue/web bundle
pnpm --filter @ts-rogue/web snapshot   # prints GAME_SNAPSHOT_ID
vercel env add GAME_SNAPSHOT_ID production
```

Only rebuild the snapshot when node-pty or the Node runtime changes; game
changes ship with the normal deploy. Without `GAME_SNAPSHOT_ID` the session
route answers 503 and the splash shows the error. `NEXT_PUBLIC_TERMINAL_WS_URL` still points the client at any fixed
host for debugging.

## Verify

- `pnpm web:dev`, open the page, play it.
- `pnpm check` and `pnpm web:build` pass. `src/web/session.test.ts` boots the
  real game, detaches, reattaches, takes over from another tab, and checks
  SIGTERM wrote a save.
