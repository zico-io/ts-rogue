"use client";

import type { WTerm } from "@wterm/dom";
import { Terminal } from "@wterm/react";
import "@wterm/react/css";
import { useEffect, useRef, useState } from "react";

/**
 * Where the PTY lives. Same-origin in local dev (the custom server in
 * `server.ts`); a deployed build has no PTY host, so it stays unset and the
 * page says so instead of retrying forever.
 */
const WS_URL = process.env.NEXT_PUBLIC_TERMINAL_WS_URL;

function terminalUrl(): string | undefined {
  if (WS_URL) return WS_URL + window.location.search;
  // ponytail: same-origin only; a deployed build sets NEXT_PUBLIC_TERMINAL_WS_URL.
  if (process.env.NEXT_PUBLIC_VERCEL_ENV) return undefined;
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}/api/terminal${window.location.search}`;
}

export function GameTerminal() {
  const socket = useRef<WebSocket | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    return () => {
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
   */
  const connect = (wt: WTerm) => {
    const url = terminalUrl();
    if (!url) {
      setOffline(true);
      return;
    }
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => send({ t: "r", cols: wt.cols, rows: wt.rows });
    ws.onmessage = (event) => {
      wt.write(
        typeof event.data === "string"
          ? event.data
          : new Uint8Array(event.data as ArrayBuffer),
      );
    };
    socket.current = ws;
  };

  if (offline) {
    return (
      <p className="offline">
        No terminal host attached. Run <code>pnpm web:dev</code> to play.
      </p>
    );
  }

  return (
    <Terminal
      autoResize
      className="terminal"
      onData={(d) => send({ t: "i", d })}
      onReady={connect}
      onResize={(cols, rows) => send({ t: "r", cols, rows })}
    />
  );
}
