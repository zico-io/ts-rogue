import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { readSlot } from "../persistence/sqliteStorage";
import {
  CLOSE_REPLACED,
  GameSession,
  gameArgs,
  parseClientMessage,
  tokenOk,
} from "./session";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli");

describe("gameArgs", () => {
  it("passes through the terminal's own flags", () => {
    expect(gameArgs(new URLSearchParams("seed=42&fresh&dev"))).toEqual([
      "--seed=42",
      "--fresh",
      "--dev",
    ]);
  });

  it("drops a seed that is not a safe integer", () => {
    expect(gameArgs(new URLSearchParams("seed=1;rm -rf /"))).toEqual([]);
    expect(gameArgs(new URLSearchParams("seed=1e999"))).toEqual([]);
  });
});

describe("parseClientMessage", () => {
  it("accepts input and resize frames", () => {
    expect(parseClientMessage('{"t":"i","d":"x"}')).toEqual({ t: "i", d: "x" });
    expect(parseClientMessage('{"t":"r","cols":80,"rows":24}')).toEqual({
      t: "r",
      cols: 80,
      rows: 24,
    });
  });

  it("rejects malformed, unknown, and non-positive frames", () => {
    for (const raw of [
      "not json",
      "null",
      '{"t":"nope"}',
      '{"t":"i"}',
      '{"t":"r","cols":0,"rows":24}',
    ]) {
      expect(parseClientMessage(raw)).toBeUndefined();
    }
  });
});

describe("tokenOk", () => {
  it("requires the exact token only when one is configured", () => {
    expect(tokenOk("/?token=abc", "abc")).toBe(true);
    expect(tokenOk("/?token=abd", "abc")).toBe(false);
    expect(tokenOk("/", "abc")).toBe(false);
    expect(tokenOk("/", undefined)).toBe(true);
  });
});

/** A client that collects everything the game draws. */
function client(url: string) {
  const ws = new WebSocket(url);
  const c = { ws, output: "", closeCode: 0 };
  ws.on("message", (data) => {
    c.output += data.toString();
  });
  ws.on("close", (code) => {
    c.closeCode = code;
  });
  return c;
}

async function until(pred: () => boolean, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (!pred() && Date.now() < deadline) await delay(100);
}

describe("GameSession", () => {
  it("survives a disconnect, redraws on reattach, replaces an older tab, saves on stop", async () => {
    const saveDir = mkdtempSync(join(tmpdir(), "ts-rogue-test-"));
    const savePath = join(saveDir, "save.db");
    let exitCode: number | undefined;
    const session = new GameSession({
      command: [TSX_CLI, "src/app.tsx", "--seed=1", "--fresh"],
      cwd: REPO_ROOT,
      savePath,
      detachTtlMs: 60_000,
      onExit: (code) => {
        exitCode = code;
      },
    });
    const server = createServer();
    const wss = new WebSocketServer({ server });
    wss.on("connection", (ws) => session.attach(ws));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/`;

    try {
      // The Ink title screen has to actually render through the PTY. Stop early
      // if the game died, so a failure reports why instead of an empty string.
      const a = client(url);
      await new Promise((resolve) => a.ws.on("open", resolve));
      a.ws.send(JSON.stringify({ t: "r", cols: 100, rows: 30 }));
      await until(
        () => a.output.includes("New Game") || a.closeCode > 0,
        60_000,
      );
      expect(a.output || "(no output before close)").toContain("New Game");

      // Start a run: New Game -> class -> mode -> name, all defaults.
      for (let i = 0; i < 4; i++) {
        a.ws.send(JSON.stringify({ t: "i", d: "\r" }));
        await delay(300);
      }
      await until(
        () => !a.output.includes("New Game") && a.output.length > 0,
        10_000,
      );
      a.ws.close();
      await delay(300);
      expect(session.isEnded).toBe(false);

      // Same process, same size: the nudge must make Ink repaint for the new tab.
      const b = client(url);
      await new Promise((resolve) => b.ws.on("open", resolve));
      b.ws.send(JSON.stringify({ t: "r", cols: 100, rows: 30 }));
      await until(() => b.output.length > 0, 10_000);
      expect(b.output.length).toBeGreaterThan(0);
      expect(b.output).not.toContain("New Game");

      // A third tab takes over and the second is told so.
      const c = client(url);
      await new Promise((resolve) => c.ws.on("open", resolve));
      await until(() => b.closeCode > 0, 5_000);
      expect(b.closeCode).toBe(CLOSE_REPLACED);

      // SIGTERM saves the live run before quitting.
      expect(readSlot(savePath)).toBeUndefined();
      session.stop();
      await until(() => exitCode !== undefined, 10_000);
      expect(exitCode).toBe(0);
      expect(readSlot(savePath)).toBeDefined();
      c.ws.close();
    } finally {
      session.stop();
      await new Promise<void>((resolve) =>
        wss.close(() => server.close(() => resolve())),
      );
      rmSync(saveDir, { recursive: true, force: true });
    }
  }, 120_000);
});
