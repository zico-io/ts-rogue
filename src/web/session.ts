import * as pty from "node-pty";
import type { WebSocket } from "ws";

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

/** Close code sent to a client that another tab replaced. The client must not reconnect. */
export const CLOSE_REPLACED = 4000;
/** Close code for a wrong or missing session token. */
export const CLOSE_BAD_TOKEN = 4401;

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

/** True when no token is required, or the request carries the right one. */
export function tokenOk(url: string, expected: string | undefined): boolean {
  if (!expected) return true;
  const given = new URL(url, "http://localhost").searchParams.get("token");
  return given === expected;
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
function gameEnv(
  savePath: string,
  autosaveMs?: number,
): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    LANG: process.env.LANG ?? "en_US.UTF-8",
    TERM: "xterm-256color",
    FORCE_COLOR: "3",
    TS_ROGUE_SAVE_PATH: savePath,
  };
  if (autosaveMs) env.TS_ROGUE_AUTOSAVE_MS = String(autosaveMs);
  return env;
}

function isOpen(ws: WebSocket | undefined): ws is WebSocket {
  return ws !== undefined && ws.readyState === ws.OPEN;
}

export interface GameSessionOptions {
  /** argv for the game, run under this same Node binary: `[entry, ...flags]`. */
  command: string[];
  cwd: string;
  savePath: string;
  /** With no client attached for this long, the game is told to save and quit. */
  detachTtlMs: number;
  /** With a client attached but no keystroke for this long, same thing. */
  idleMs?: number;
  /** Passed to the game as TS_ROGUE_AUTOSAVE_MS. */
  autosaveMs?: number;
  onExit: (exitCode: number) => void;
}

/**
 * One long-lived game process that browsers attach to and detach from.
 *
 * The socket is not the session: closing the tab leaves the game running for
 * `detachTtlMs` so a reload or a flaky network lands back in the same run.
 * The last attach wins; an earlier client is closed with CLOSE_REPLACED.
 */
export class GameSession {
  readonly pid: number;
  private readonly term: pty.IPty;
  private client: WebSocket | undefined;
  private timer: NodeJS.Timeout | undefined;
  private ended = false;

  constructor(private readonly opts: GameSessionOptions) {
    this.term = pty.spawn(process.execPath, opts.command, {
      name: "xterm-256color",
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      cwd: opts.cwd,
      env: gameEnv(opts.savePath, opts.autosaveMs),
    });
    this.pid = this.term.pid;
    this.term.onData((data) => {
      if (isOpen(this.client)) this.client.send(data);
    });
    this.term.onExit(({ exitCode, signal }) => {
      this.ended = true;
      clearTimeout(this.timer);
      if (isOpen(this.client)) {
        // A game that dies before drawing would otherwise leave a blank
        // terminal with no clue why, so say so on the way out.
        if (exitCode !== 0) {
          this.client.send(
            `\r\n[game exited: code ${exitCode}${signal ? `, signal ${signal}` : ""}]\r\n`,
          );
        }
        this.client.close();
      }
      opts.onExit(exitCode);
    });
    this.arm(opts.detachTtlMs);
  }

  get isEnded(): boolean {
    return this.ended;
  }

  attach(ws: WebSocket): void {
    if (this.ended) {
      ws.close();
      return;
    }
    this.client?.close(CLOSE_REPLACED, "another tab took over this game");
    this.client = ws;
    this.arm(this.opts.idleMs);

    let sized = false;
    ws.on("message", (raw) => {
      if (this.ended || this.client !== ws) return;
      const msg = parseClientMessage(raw.toString());
      if (!msg) return;
      if (msg.t === "i") {
        this.term.write(msg.d);
        this.arm(this.opts.idleMs);
        return;
      }
      if (sized) {
        this.term.resize(msg.cols, msg.rows);
        return;
      }
      sized = true;
      // Ink set these modes when it booted, before this client existed.
      ws.send("\x1b[?1049h\x1b[?25l");
      // A fresh client has a blank screen, and Ink only rewrites a frame that
      // changed. It does clear and repaint when the width shrinks, so shrink by
      // one column and grow back. Two SIGWINCHes back to back coalesce, hence
      // the pause.
      this.term.resize(msg.cols - 1, msg.rows);
      setTimeout(() => {
        if (!this.ended && this.client === ws)
          this.term.resize(msg.cols, msg.rows);
      }, 50);
    });
    const detach = () => {
      if (this.client !== ws) return;
      this.client = undefined;
      this.arm(this.opts.detachTtlMs);
    };
    ws.on("close", detach);
    ws.on("error", detach);
  }

  /** Ask the game to save and quit; force it if it has not gone in 5 s. */
  stop(): void {
    if (this.ended) return;
    this.term.kill("SIGTERM");
    setTimeout(() => {
      if (!this.ended) this.term.kill("SIGKILL");
    }, 5_000).unref();
  }

  private arm(ms: number | undefined): void {
    clearTimeout(this.timer);
    if (!ms || this.ended) return;
    this.timer = setTimeout(() => this.stop(), ms);
  }
}
