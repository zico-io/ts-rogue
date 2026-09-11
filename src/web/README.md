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

## Wiki (`/help`)

The game's help center and wiki, built on the licensed **beUI Pro**
`knowledge-help-center` block installed through the shadcn registry
(`components.json` declares `@beui` and `@beui-pro`; the private registry reads
its bearer token from `$BEUI_PRO_TOKEN` and it is never committed). Re-add or
update it with:

```bash
pnpm dlx shadcn@latest add @beui-pro/knowledge-help-center
```

- `app/help/page.tsx` - the route: a thin nav back to the portal plus
  `<KnowledgeHelpCenter>`.
- `app/help/help.css` - the **only** Tailwind entry point in this app. It is
  imported by `app/help/layout.tsx`, not the root layout, so Tailwind (and its
  preflight reset) ships in the `/help` route chunk and never touches the game
  portal, which stays on hand-written `globals.css`. Its theme tokens map
  shadcn's semantic names onto the game's chamber palette (`#07070d` ground,
  parchment ink, gold primary, indigo accent) so the wiki reads as the same
  artifact as the portal.
- `components/premium/knowledge-base/knowledge-data.ts` - the article content.
  This is the wiki: 14 articles across Getting started, Combat, Exploration,
  and Progression, written from `src/engine/README.md`. Add a page by appending
  a `KnowledgeArticle`. A new topic means appending to `KNOWLEDGE_CATEGORIES`
  with its icon and blurb - `KnowledgeCategory` is derived from that list, so
  the topic cards pick it up and an article naming a topic that is not there
  is a type error.
- `components/motion/tabs.tsx` - installed beUI primitive, patched twice. Both
  `TabsList` and `TabsTrigger` now forward the rest of their DOM props, which
  the stock source dropped: `aria-label` on the list went nowhere, leaving the
  tablist unnamed. And the WAI-ARIA tab keyboard pattern lives here rather than
  in each usage - `TabsList` handles arrow keys, Home, and End, and
  `TabsTrigger` sets its own roving `tabIndex`. The help center only supplies
  the `id` and `aria-controls` wiring that ties the tabs to their panel.

The `@/*` import alias the installed source uses is declared in both
`tsconfig.json` (as `./src/web/*`, for the repo-wide `tsgo` typecheck) and
`src/web/tsconfig.json` (as `./*`, because Next resolves paths from the app's
own tsconfig).

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
