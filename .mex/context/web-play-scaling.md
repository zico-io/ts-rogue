---
name: web-play-scaling
description: How browser play is hosted (one Vercel Sandbox per player) and the Kubernetes game-host design to move to if Sandbox limits bite. Load when touching src/web/lib/sandbox.ts, pty-server.ts, or capacity/cost questions about web play.
triggers:
  - "sandbox"
  - "kubernetes"
  - "k8s"
  - "scaling"
  - "cold start"
  - "session"
  - "pty-server"
last_updated: 2026-09-09
---

# Hosting browser play

Decided 2026-09-09. Requirements: thousands of concurrent players, near-zero
cost when idle, cold start hidden behind a client-drawn splash, a live process
that survives a disconnect for 10 minutes, anonymous cookie identity.

A game process is Node + Ink at ~150 MB RSS and ~0 CPU while waiting for a key.
Thousands concurrent is hundreds of GB at peak and nothing at idle, so compute
has to be elastic per session. Vercel Functions cap duration at minutes and
cannot own a PTY, so the WebSocket terminates wherever the process lives.

## Now: one Vercel Sandbox per player

```
browser -> POST /api/session (cookie tsr_token)
             Sandbox.getOrCreate({ name: "player-<token>", source: snapshot })
             start pty-server if /health is down, return wss://<id>.vercel.run/?token=
browser -> wss -> pty-server (src/web/pty-server.ts) -> node-pty -> node app.js
```

- **Session = named persistent sandbox.** `stop()` snapshots the filesystem
  (save.db included); `getOrCreate` resumes it by name. Nothing else stores state.
- **Image** = a sandbox snapshot holding only node-pty (native, cannot be
  bundled), built by `src/web/scripts/snapshot.ts`, id in `GAME_SNAPSHOT_ID`.
  The game itself (`dist/app.js`, `dist/pty-server.js`, built by `pnpm bundle`
  during `next build`) ships inside the Next deployment; the session route
  uploads it into a sandbox whose `app/VERSION` differs before starting the
  game. So a deploy reaches every player's sandbox on their next session, and
  the snapshot only changes when node-pty or the runtime does. Boot from
  snapshot, upload, and node start together are 3-4 s cold, hidden by the
  splash; a warm sandbox answers in well under a second.
- **Lifecycle**: no client for 10 min, or no keystroke for 60 min, pty-server
  sends the game SIGTERM (it autosaves, see `src/app.tsx`), exits, and POSTs
  `/api/session/stopped` so the web app stops the VM now rather than at its
  24 h timeout. Sandbox timeout is the backstop, not the mechanism.
- **Auth**: the wss URL is per-sandbox and the socket also needs `?token=`,
  which only that sandbox was ever told.
- **Idle cost**: zero compute; snapshots expire after 30 days.

Limits that would force a move (Pro plan, team gargoyle): concurrent sandbox
cap, cost per provisioned GB-hour at sustained load, or the 24 h session cap
if runs get longer than that without a detach.

## Later: Kubernetes game host

The cluster exists but is not wired to the app. Same wire protocol, same
pty-server; only where it runs changes.

```
browser -> wss -> ingress (TLS, WS) -> game-host pod (many sessions per pod)
Next.js -> POST /api/session -> Redis: token -> { pod, since }
saves -> Postgres or S3 blob on detach; loaded into the pod on attach
```

- `game-host` Deployment: image = `dist/` + node-pty, runs N `GameSession`s per
  pod (today's class already supports many if given a map like `server.ts`).
- HPA on an active-sessions metric, cluster autoscaler for nodes, min 1 small
  replica as the idle floor (~$10-30/mo). Node scale-up lag (10-60 s) is
  covered by keeping one pod of headroom; the splash hides the rest.
- Reconnect stickiness: `token -> pod` in Redis, and either a thin WS gateway
  that proxies to that pod or per-pod addressing through the ingress. The
  gateway is the simpler operational story.
- Saves cannot live on the pod: write `save.db` to Postgres/S3 on detach and
  on autosave, restore on attach.
- Wins: no per-session lifetime cap, cheaper per player-hour at sustained
  load. Costs: image CI, ingress + cert, Redis, metrics adapter, a gateway,
  save storage, all run by us. About six components before the first player,
  which is why Sandbox came first.
