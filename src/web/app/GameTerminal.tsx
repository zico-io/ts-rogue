"use client";

import type { WTerm } from "@wterm/dom";
import { Terminal } from "@wterm/react";
import "@wterm/react/css";
import { useEffect, useRef, useState } from "react";
import { LOGO } from "../../ui/screens/title/display";
import { theme } from "../../ui/theme";

/** Close code from the server when another tab took over this game. */
const CLOSE_REPLACED = 4000;

/**
 * Where the PTY lives. Same-origin in local dev (the custom server in
 * `server.ts`); on Vercel the game runs in the player's sandbox, whose URL
 * comes from `/api/session`. `NEXT_PUBLIC_TERMINAL_WS_URL` overrides both.
 */
async function terminalUrl(): Promise<string> {
  const fixed = process.env.NEXT_PUBLIC_TERMINAL_WS_URL;
  if (fixed) return fixed + window.location.search;
  if (!process.env.NEXT_PUBLIC_VERCEL_ENV) {
    const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${scheme}//${window.location.host}/api/terminal${window.location.search}`;
  }
  const res = await fetch(`/api/session${window.location.search}`, {
    method: "POST",
  });
  const body = (await res.json()) as { wsUrl?: string; error?: string };
  if (!res.ok || !body.wsUrl) throw new Error(body.error ?? res.statusText);
  return body.wsUrl;
}

function rgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `\x1b[38;2;${n >> 16};${(n >> 8) & 255};${n & 255}m`;
}

/**
 * The game's own title, drawn locally before the process behind it has
 * booted, so the screen is never blank. The real title screen overwrites it.
 */
function paintSplash(wt: WTerm, status: string): void {
  const lines = [...LOGO, "", status];
  const top = Math.max(0, Math.floor((wt.rows - lines.length) / 2));
  // One left edge for the whole logo, or its ragged lines drift apart.
  const logoWidth = Math.max(...LOGO.map((line) => line.length));
  const logoLeft = Math.max(0, Math.floor((wt.cols - logoWidth) / 2));
  let out = "\x1b[?1049h\x1b[?25l\x1b[2J\x1b[H";
  lines.forEach((line, i) => {
    const isLogo = i < LOGO.length;
    const color = isLogo
      ? (theme.logoGradient[i] ?? theme.text)
      : theme.textMuted;
    const left = isLogo
      ? logoLeft
      : Math.max(0, Math.floor((wt.cols - line.length) / 2));
    out += `\x1b[${top + i + 1};${left + 1}H${rgb(color)}${line}\x1b[0m`;
  });
  wt.write(out);
}

export function GameTerminal() {
  const socket = useRef<WebSocket | null>(null);
  const disposed = useRef(false);
  /** Set while the splash is showing, so a late grid resize re-centers it. */
  const splash = useRef<{ wt: WTerm; status: string } | null>(null);
  const [replaced, setReplaced] = useState(false);

  useEffect(() => {
    return () => {
      disposed.current = true;
      socket.current?.close();
      socket.current = null;
    };
  }, []);

  const send = (message: object) => {
    const ws = socket.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  };

  /**
   * Connect only once the WASM grid exists: writes before `init()` resolves are
   * dropped, and by now `autoResize` has settled on the real size, so the game
   * boots straight into it instead of starting at 80x24 and redrawing.
   *
   * Reconnects with backoff. Every attempt asks `/api/session` again, so a
   * sandbox that stopped while the tab was asleep is simply started again.
   */
  const showSplash = (wt: WTerm, status: string) => {
    splash.current = { wt, status };
    paintSplash(wt, status);
  };

  const connect = (wt: WTerm) => {
    showSplash(wt, "Connecting...");
    let attempt = 0;
    const open = async () => {
      if (disposed.current) return;
      let url: string;
      try {
        url = await terminalUrl();
      } catch (error) {
        showSplash(wt, `Could not start the game: ${String(error)}`);
        retry();
        return;
      }
      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      ws.onopen = () => {
        attempt = 0;
        send({ t: "r", cols: wt.cols, rows: wt.rows });
      };
      ws.onmessage = (event) => {
        // Ink only redraws its own lines; wipe the splash before its first frame.
        if (splash.current) wt.write("\x1b[2J\x1b[H");
        splash.current = null;
        wt.write(
          typeof event.data === "string"
            ? event.data
            : new Uint8Array(event.data as ArrayBuffer),
        );
      };
      ws.onclose = (event) => {
        if (disposed.current || socket.current !== ws) return;
        if (event.code === CLOSE_REPLACED) {
          setReplaced(true);
          return;
        }
        showSplash(wt, "Reconnecting...");
        retry();
      };
      socket.current = ws;
    };
    const retry = () => {
      attempt += 1;
      setTimeout(open, Math.min(1_000 * 2 ** attempt, 10_000));
    };
    void open();
  };

  if (replaced) {
    return (
      <p className="offline">
        This game is now open in another tab. Reload to take it back.
      </p>
    );
  }

  return (
    <Terminal
      autoResize
      className="terminal"
      onData={(d) => send({ t: "i", d })}
      onReady={connect}
      onResize={(cols, rows) => {
        if (splash.current)
          paintSplash(splash.current.wt, splash.current.status);
        send({ t: "r", cols, rows });
      }}
    />
  );
}
