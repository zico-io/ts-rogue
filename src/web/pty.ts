import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as pty from "node-pty";
import type { WebSocket, WebSocketServer } from "ws";

/** Repo root: the game is run as `tsx src/app.tsx` from there. */
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Resolve tsx's CLI module and run it under this same Node binary, rather than
 * spawning `node_modules/.bin/tsx`. That path is a package-manager-generated
 * shell shim whose layout varies by package manager and platform; resolving the
 * module is exact everywhere.
 */
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli");

/** Ink's MinSizeGuard needs 64x24; the client resizes to its real size on connect. */
const DEFAULT_COLS = 100;
const DEFAULT_ROWS = 30;

/**
 * The browser's half of the wire: JSON only. Output travels the other way as
 * raw PTY bytes, which wterm writes through unframed.
 */
export type ClientMessage =
  | { t: "i"; d: string }
  | { t: "r"; cols: number; rows: number };

/**
 * Query params become process arguments, so every value is checked here rather
 * than trusted. Mirrors the terminal's own `--seed=`/`--fresh`/`--dev` flags.
 */
export function gameArgs(search: URLSearchParams): string[] {
  const args: string[] = [];
  const seed = Number(search.get("seed"));
  if (search.has("seed") && Number.isSafeInteger(seed)) {
    args.push(`--seed=${seed}`);
  }
  if (search.has("fresh")) args.push("--fresh");
  if (search.has("dev")) args.push("--dev");
  return args;
}

/** Parses one client frame, returning undefined for anything malformed. */
export function parseClientMessage(raw: string): ClientMessage | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const msg = value as Record<string, unknown>;
  if (msg.t === "i" && typeof msg.d === "string") return { t: "i", d: msg.d };
  if (
    msg.t === "r" &&
    Number.isSafeInteger(msg.cols) &&
    Number.isSafeInteger(msg.rows) &&
    (msg.cols as number) > 0 &&
    (msg.rows as number) > 0
  ) {
    return { t: "r", cols: msg.cols as number, rows: msg.rows as number };
  }
  return undefined;
}

/**
 * A deliberately minimal environment, not `process.env`.
 *
 * Inheriting the server's environment did two bad things. It leaked every
 * server secret (`VERCEL_TOKEN` and friends) into a process driven by whatever
 * a browser sends, and it passed `CI` through: Ink stops rendering
 * incrementally when it detects CI and buffers until exit, so an interactive
 * game that never exits drew a permanently blank terminal with no error.
 *
 * The game is attached to a real interactive PTY, so it is told exactly that.
 * One consequence: `?dev` cannot reach Linear credentials, which is the right
 * default for a browser-facing process.
 */
function gameEnv(savePath: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    LANG: process.env.LANG ?? "en_US.UTF-8",
    TERM: "xterm-256color",
    FORCE_COLOR: "3",
    TS_ROGUE_SAVE_PATH: savePath,
  };
}

/**
 * Runs one game process for one socket: a private save file, output streamed to
 * the browser, and both torn down when either side goes away.
 */
export function attachSession(ws: WebSocket, url: string): void {
  const search = new URL(url, "http://localhost").searchParams;
  const saveDir = mkdtempSync(join(tmpdir(), "ts-rogue-"));

  let term: pty.IPty;
  try {
    term = pty.spawn(
      process.execPath,
      [TSX_CLI, "src/app.tsx", ...gameArgs(search)],
      {
        name: "xterm-256color",
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
        cwd: REPO_ROOT,
        env: gameEnv(join(saveDir, "save.db")),
      },
    );
  } catch (error) {
    // Without this the browser just shows an empty terminal forever.
    rmSync(saveDir, { recursive: true, force: true });
    if (ws.readyState === ws.OPEN) {
      ws.send(`\r\n[could not start the game: ${String(error)}]\r\n`);
      ws.close();
    }
    return;
  }

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    try {
      term.kill();
    } catch {
      // Already gone; the scratch dir still has to go.
    }
    rmSync(saveDir, { recursive: true, force: true });
  };

  term.onData((data) => {
    if (ws.readyState === ws.OPEN) ws.send(data);
  });
  term.onExit(({ exitCode, signal }) => {
    cleanup();
    if (ws.readyState !== ws.OPEN) return;
    // A game that dies before drawing would otherwise leave a blank terminal
    // with no clue why, so say so on the way out.
    if (exitCode !== 0) {
      ws.send(
        `\r\n[game exited: code ${exitCode}${signal ? `, signal ${signal}` : ""}]\r\n`,
      );
    }
    ws.close();
  });

  ws.on("message", (raw) => {
    if (closed) return;
    const msg = parseClientMessage(raw.toString());
    if (!msg) return;
    if (msg.t === "i") term.write(msg.d);
    else term.resize(msg.cols, msg.rows);
  });
  ws.on("close", cleanup);
  ws.on("error", cleanup);
}

/** Wires every connection on `wss` to its own game process. */
export function serveSessions(wss: WebSocketServer): void {
  wss.on("connection", (ws, request) => {
    attachSession(ws, request.url ?? "/");
  });
}
