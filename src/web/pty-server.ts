/**
 * The PTY host that runs inside a player's Vercel Sandbox: one game, one
 * WebSocket port, a health endpoint. Bundled to dist/pty-server.js next to
 * dist/app.js by `pnpm bundle`.
 */
import { createServer } from "node:http";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { CLOSE_BAD_TOKEN, GameSession, gameArgs, tokenOk } from "./session";

const MINUTE = 60_000;
const port = Number(process.env.PORT ?? 7681);
const token = process.env.TSR_TOKEN;
const entry =
  process.env.GAME_ENTRY ?? fileURLToPath(new URL("./app.js", import.meta.url));

const session = new GameSession({
  command: [entry, ...gameArgs(new URLSearchParams(process.env.GAME_QUERY))],
  cwd: dirname(entry),
  savePath: process.env.TS_ROGUE_SAVE_PATH ?? "/vercel/sandbox/save.db",
  detachTtlMs: 10 * MINUTE,
  idleMs: 60 * MINUTE,
  autosaveMs: 5 * MINUTE,
  onExit: async (code) => {
    // The sandbox does not stop when we do; tell the web app so it can.
    const origin = process.env.WEB_ORIGIN;
    if (origin && token) {
      await fetch(`${origin}/api/session/stopped`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      }).catch(() => undefined);
    }
    process.exit(code);
  },
});

const server = createServer((_req, res) => {
  res.end("ok");
});
const wss = new WebSocketServer({ server });
wss.on("connection", (ws, req) => {
  if (!tokenOk(req.url ?? "/", token)) {
    ws.close(CLOSE_BAD_TOKEN, "bad token");
    return;
  }
  session.attach(ws);
});
server.listen(port, () => {
  console.log(`pty-server on :${port}, game pid ${session.pid}`);
});
