import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import next from "next";
import { WebSocketServer } from "ws";
import { GameSession, gameArgs } from "./session";

export const TERMINAL_PATH = "/api/terminal";

/** Repo root: locally the game is run as `tsx src/app.tsx` from there. */
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Resolve tsx's CLI module and run it under this same Node binary, rather than
 * spawning `node_modules/.bin/tsx`. That path is a package-manager-generated
 * shell shim whose layout varies by package manager and platform; resolving the
 * module is exact everywhere.
 */
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli");

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);

const app = next({ dev, dir: import.meta.dirname });
await app.prepare();

const server = createServer(app.getRequestHandler());
const wss = new WebSocketServer({ server, path: TERMINAL_PATH });

/**
 * Local stand-in for one sandbox per player: one game per distinct query
 * string, kept alive across reloads the same way production is.
 */
const sessions = new Map<string, GameSession>();
wss.on("connection", (ws, request) => {
  const key = request.url ?? "/";
  let session = sessions.get(key);
  if (!session || session.isEnded) {
    const search = new URL(key, "http://localhost").searchParams;
    const saveDir = mkdtempSync(join(tmpdir(), "ts-rogue-"));
    session = new GameSession({
      command: [TSX_CLI, "src/app.tsx", ...gameArgs(search)],
      cwd: REPO_ROOT,
      savePath: join(saveDir, "save.db"),
      detachTtlMs: 10 * 60_000,
      autosaveMs: 5 * 60_000,
      onExit: () => {
        sessions.delete(key);
        rmSync(saveDir, { recursive: true, force: true });
      },
    });
    sessions.set(key, session);
  }
  session.attach(ws);
});

server.listen(port, () => {
  console.log(`ts-rogue on http://localhost:${port}`);
});
