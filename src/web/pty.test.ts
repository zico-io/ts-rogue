import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { gameArgs, parseClientMessage, serveSessions } from "./pty";

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

describe("attachSession", () => {
  it("streams the real game and reaps it when the socket closes", async () => {
    const server = createServer();
    serveSessions(new WebSocketServer({ server, path: "/api/terminal" }));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/api/terminal?seed=1&fresh`,
    );
    let output = "";
    let closed = false;
    ws.on("message", (data) => {
      output += data.toString();
    });
    ws.on("close", () => {
      closed = true;
    });
    await new Promise((resolve) => ws.on("open", resolve));
    ws.send(JSON.stringify({ t: "r", cols: 100, rows: 30 }));

    // The Ink title screen has to actually render through the PTY. Stop early
    // if the game died, so a failure reports why instead of an empty string.
    const deadline = Date.now() + 60_000;
    while (!output.includes("New Game") && !closed && Date.now() < deadline) {
      await delay(100);
    }
    expect(
      output || "(the game produced no output before the socket closed)",
    ).toContain("New Game");

    ws.close();
    await delay(500);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }, 90_000);
});
