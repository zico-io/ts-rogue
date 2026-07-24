#!/usr/bin/env node
// Drive the real WEB game (PixiJS on a WebGL canvas, served by the Next.js dev
// server) so an agent can see and refine the browser UI like a user. The web
// analogue of scripts/play.sh: same seed+keylog repro and key-token vocabulary,
// but a canvas can't be text-scraped, so "frame" becomes a real PNG screenshot
// from a headless browser instead of `tmux capture-pane`.
//
//   node scripts/play-web.mjs start [seed] [w] [h] [--dev]  boot next dev, reset run
//   node scripts/play-web.mjs key <tokens...>               record keystrokes
//   node scripts/play-web.mjs shot [out.png]                screenshot the game
//   node scripts/play-web.mjs stop                          stop the dev server
//   node scripts/play-web.mjs --selftest                    check the key map
//
// The Next.js dev server is the only persistent process. Each `shot` launches
// chromium fresh, opens /?seed=<seed>&fresh, replays the recorded keys (game
// state is deterministic from seed+keys via the shared engine), captures, and
// exits - no browser daemon to leak in a sandbox.
// ponytail: replay-from-scratch per shot; if per-shot latency ever bites, hold a
// persistent page open behind a local IPC server (see scripts/play.sh's tmux daemon).

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../..");
const KEYLOG = path.join(ROOT, ".play-web-keys.log");
const STATE = path.join(ROOT, ".play-web.json");
const FRAMES = path.join(ROOT, ".play-web-frames");
const PORT = 5173;
// Bind and reach the dev server on explicit IPv4 (passed to `next dev -H`), so a
// 127.0.0.1 readiness probe always matches where the server actually listens.
const HOST = "127.0.0.1";
const URL_BASE = `http://${HOST}:${PORT}`;

// tmux names special keys; the web renderer reads KeyboardEvent.key. Map the
// play.sh token vocabulary onto Playwright key names so the same `key Up Enter 3`
// works under either renderer. Anything not here (letters, digits, `>`, backtick)
// is a literal character Playwright presses directly.
const KEY_MAP = {
  Up: "ArrowUp",
  Down: "ArrowDown",
  Left: "ArrowLeft",
  Right: "ArrowRight",
  Enter: "Enter",
  Escape: "Escape",
  Tab: "Tab",
  Space: "Space",
  Backspace: "Backspace",
  Delete: "Delete",
};

export function toPlaywrightKey(token) {
  return KEY_MAP[token] ?? token;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE, "utf8"));
  } catch {
    return {};
  }
}

function portOpen(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: HOST }, () => {
      sock.end();
      resolve(true);
    });
    sock.on("error", () => resolve(false));
    sock.setTimeout(500, () => {
      sock.destroy();
      resolve(false);
    });
  });
}

async function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portOpen(port)) return true;
    await sleep(300);
  }
  return false;
}

async function cmdStart(args) {
  const dev = args.includes("--dev");
  const positional = args.filter((a) => !a.startsWith("--"));
  const seed = Number(positional[0] ?? 1);
  const width = Number(positional[1] ?? 1280);
  const height = Number(positional[2] ?? 800);
  fs.writeFileSync(KEYLOG, "");
  fs.writeFileSync(STATE, JSON.stringify({ seed, width, height, dev }));

  if (await portOpen(PORT)) {
    console.log(`dev server already up on :${PORT} (seed=${seed}); now: shot`);
    return;
  }
  // Run `next dev` directly (not `pnpm web:dev`, whose arg forwarding mangles
  // flags), pointed at the src/web app, on an explicit host+port. Detached
  // process group so `stop` can kill next + its child compilers.
  const child = spawn(
    "pnpm",
    ["exec", "next", "dev", "src/web", "-H", HOST, "-p", String(PORT)],
    { cwd: ROOT, detached: true, stdio: "ignore" },
  );
  child.unref();
  fs.writeFileSync(
    STATE,
    JSON.stringify({ seed, width, height, dev, vitePid: child.pid }),
  );
  if (!(await waitForPort(PORT, 60000))) {
    throw new Error(`next dev did not come up on :${PORT} within 60s`);
  }
  console.log(
    `started next dev on :${PORT} (seed=${seed} ${width}x${height}${dev ? " dev" : ""}); now: shot`,
  );
}

function cmdKey(tokens) {
  if (tokens.length === 0) {
    console.error("usage: node scripts/play-web.mjs key <tokens...>");
    process.exit(1);
  }
  // Mirror play.sh: append the repro sequence, one call per line.
  fs.appendFileSync(KEYLOG, `${tokens.join(" ")}\n`);
}

async function cmdShot(args) {
  if (!(await portOpen(PORT))) {
    console.error("no web session; run: node scripts/play-web.mjs start");
    process.exit(1);
  }
  const { chromium } = await import("playwright");
  const state = readState();
  const seed = state.seed ?? 1;
  const width = state.width ?? 1280;
  const height = state.height ?? 800;
  const outPath = path.resolve(
    args[0] ?? path.join(FRAMES, "frame.png"),
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const query = `?seed=${seed}&fresh${state.dev ? "&dev" : ""}`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(`${URL_BASE}/${query}`, { waitUntil: "load" });
    // GamePortal mounts app.canvas into #portal only after the client-side
    // dynamic import of bootGame and its async atlas load; the Next dev server
    // also compiles the route on first request, so allow a generous timeout.
    await page.waitForSelector("#portal canvas", { timeout: 45000 });
    await sleep(500);

    const tokens = fs
      .readFileSync(KEYLOG, "utf8")
      .split("\n")
      .flatMap((line) => line.trim().split(/\s+/))
      .filter(Boolean);
    for (const token of tokens) {
      await page.keyboard.press(toPlaywrightKey(token));
      await sleep(120); // let renderCurrent() + any scene transition settle
    }
    await sleep(500);
    await page.screenshot({ path: outPath });
    console.log(outPath);
  } finally {
    await browser.close();
  }
}

function cmdStop() {
  const { vitePid } = readState();
  if (!vitePid) {
    console.log("no session");
    return;
  }
  try {
    process.kill(-vitePid); // negative pid: kill the detached process group
  } catch {
    try {
      process.kill(vitePid);
    } catch {
      // already gone
    }
  }
  fs.rmSync(STATE, { force: true });
  console.log("stopped");
}

function selftest() {
  const assert = (cond, msg) => {
    if (!cond) throw new Error(`selftest failed: ${msg}`);
  };
  assert(toPlaywrightKey("Up") === "ArrowUp", "Up -> ArrowUp");
  assert(toPlaywrightKey("Enter") === "Enter", "Enter passthrough");
  assert(toPlaywrightKey("Space") === "Space", "Space -> Space");
  assert(toPlaywrightKey("3") === "3", "digit passthrough");
  assert(toPlaywrightKey(">") === ">", "shifted char passthrough");
  assert(toPlaywrightKey("`") === "`", "backtick passthrough");
  console.log("selftest ok");
}

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case "start":
    await cmdStart(rest);
    break;
  case "key":
    cmdKey(rest);
    break;
  case "shot":
    await cmdShot(rest);
    break;
  case "stop":
    cmdStop();
    break;
  case "--selftest":
    selftest();
    break;
  default:
    console.error("usage: node scripts/play-web.mjs {start|key|shot|stop}");
    process.exit(1);
}
