#!/usr/bin/env node

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

const HOST = "127.0.0.1";
const URL_BASE = `http://${HOST}:${PORT}`;

// A shot captured at the session's full 1280x800 viewport as a PNG runs
// ~250KB, which is ~100K tokens once base64-embedded as Markdown text.
// That's the only way a caller without filesystem access to this sandbox
// (the playtester subagent, for example) can receive the image, and that
// single shot was enough on its own to trip Eve's session token budget
// (HAR-77). Capturing at a smaller viewport and as JPEG by default cuts a
// shot to well under a tenth of that size using Playwright's own screenshot
// options, with no extra dependency and no meaningful loss of legibility for
// pixel art. `shot --full` (or an explicit `.png` path) opts back into a
// lossless capture at the session's actual configured viewport.
const SHOT_WIDTH_PX = 640;
const SHOT_HEIGHT_PX = 400;

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

  const child = spawn(
    "pnpm",
    [
      "--filter",
      "@ts-rogue/web",
      "exec",
      "next",
      "dev",
      "-H",
      HOST,
      "-p",
      String(PORT),
    ],
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

  fs.appendFileSync(KEYLOG, `${tokens.join(" ")}\n`);
}

async function cmdShot(args) {
  if (!(await portOpen(PORT))) {
    console.error("no web session; run: node scripts/play-web.mjs start");
    process.exit(1);
  }
  const full = args.includes("--full");
  const positional = args.filter((a) => !a.startsWith("--"));
  const { chromium } = await import("playwright");
  const state = readState();
  const seed = state.seed ?? 1;
  const sessionWidth = state.width ?? 1280;
  const sessionHeight = state.height ?? 800;
  const width = full ? sessionWidth : Math.min(sessionWidth, SHOT_WIDTH_PX);
  const height = full ? sessionHeight : Math.min(sessionHeight, SHOT_HEIGHT_PX);
  const outPath = path.resolve(
    positional[0] ?? path.join(FRAMES, full ? "frame.png" : "frame.jpg"),
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const query = `?seed=${seed}&fresh${state.dev ? "&dev" : ""}`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(`${URL_BASE}/${query}`, { waitUntil: "load" });

    await page.waitForSelector("#portal canvas", { timeout: 45000 });
    await sleep(500);

    const tokens = fs
      .readFileSync(KEYLOG, "utf8")
      .split("\n")
      .flatMap((line) => line.trim().split(/\s+/))
      .filter(Boolean);
    for (const token of tokens) {
      await page.keyboard.press(toPlaywrightKey(token));
      await sleep(120);
    }
    await sleep(500);
    const asPng = path.extname(outPath).toLowerCase() === ".png";
    await page.screenshot(
      asPng ? { path: outPath } : { path: outPath, type: "jpeg", quality: 80 },
    );
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
    process.kill(-vitePid);
  } catch {
    try {
      process.kill(vitePid);
    } catch {}
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
