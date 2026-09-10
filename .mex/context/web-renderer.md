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

- `server.ts` - Next custom server: `next()` + `createServer` + a
  `WebSocketServer` on `/api/terminal`. Every Next route still runs via
  `getRequestHandler()`. The eve agent is deployed separately (#218).
- `pty.ts` - one game process per socket, each with a private `save.db` in a
  scratch dir (`TS_ROGUE_SAVE_PATH`), torn down with the socket. `gameArgs`
  validates query params **at the boundary** because they become process
  arguments: a seed that is not a safe integer is dropped.
- `app/GameTerminal.tsx` - connects in `onReady`, never earlier. Writes before
  wterm's WASM grid exists are dropped, and by then `autoResize` has settled,
  so the game boots into the real size instead of starting at 80x24.

## Query params mirror CLI flags

`?seed=123`, `?fresh`, `?dev` map to `--seed=123`, `--fresh`, `--dev`, so
`?seed=1&fresh` in the browser is the same run as
`pnpm game:dev --seed=1 --fresh`. That equivalence is the point of this design
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

`next build` succeeds and Vercel serves the page, but `node-pty` is a native
addon needing a persistent Node process, so a deployed build has **no PTY host
and no playable game** until a Sandbox backend lands. `GameTerminal` detects
that and says to run locally. `NEXT_PUBLIC_TERMINAL_WS_URL` points it at a real
host. Vercel project Root Directory is `src/web`.

## Verify

- `pnpm web:dev`, open the page, play it.
- `pnpm check` and `pnpm web:build` pass. `src/web/pty.test.ts` boots a real
  server and asserts the game's title screen arrives through the PTY.
