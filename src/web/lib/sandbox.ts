import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Sandbox } from "@vercel/sandbox";

/** Port the pty-server listens on inside the sandbox; also its published route. */
export const GAME_PORT = 7681;
/** Where the game lives inside a sandbox: node-pty from the snapshot, the rest uploaded here. */
export const GAME_DIR = "/vercel/sandbox/app";
/** `pnpm bundle` output, shipped with the deployment (next.config outputFileTracingIncludes). */
const DIST = join(process.cwd(), "dist");
const GAME_FILES = ["app.js", "pty-server.js", "VERSION"];

const DAY = 86_400_000;

/**
 * On Vercel the SDK authenticates through OIDC by itself. Anywhere else
 * (local dev, the snapshot script) it needs these three explicitly.
 */
export function credentials() {
  const { VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID } = process.env;
  return VERCEL_TOKEN && VERCEL_TEAM_ID && VERCEL_PROJECT_ID
    ? {
        token: VERCEL_TOKEN,
        teamId: VERCEL_TEAM_ID,
        projectId: VERCEL_PROJECT_ID,
      }
    : {};
}

/** The player token is the sandbox name, so a stopped sandbox is found by cookie alone. */
export function sandboxName(token: string): string {
  return `player-${token}`;
}

export function isToken(value: string | undefined): value is string {
  return value !== undefined && /^[0-9a-f-]{36}$/.test(value);
}

/**
 * The player's sandbox, resumed from its last snapshot or created from the
 * game image. `env` is only applied on create; TSR_TOKEN never changes because
 * the token is the name.
 */
export async function playerSandbox(token: string): Promise<Sandbox> {
  const snapshotId = process.env.GAME_SNAPSHOT_ID;
  if (!snapshotId) throw new Error("GAME_SNAPSHOT_ID is not set");
  return Sandbox.getOrCreate({
    ...credentials(),
    name: sandboxName(token),
    source: { type: "snapshot", snapshotId },
    ports: [GAME_PORT],
    // Pro cap. The pty-server stops the sandbox long before this; the timeout is
    // the backstop if that callback ever fails.
    timeout: DAY,
    // ponytail: abandoned saves expire after a month; add a "delete save" UI if anyone asks.
    snapshotExpiration: 30 * DAY,
    keepLastSnapshots: { count: 1, deleteEvicted: true },
    env: { TSR_TOKEN: token, WEB_ORIGIN: webOrigin() },
  });
}

/** Where the sandbox reports back to (see pty-server onExit). */
function webOrigin(): string {
  if (process.env.WEB_ORIGIN) return process.env.WEB_ORIGIN;
  const host =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  return host ? `https://${host}` : "http://localhost:3000";
}

async function healthy(base: string): Promise<boolean> {
  try {
    const res = await fetch(base, { signal: AbortSignal.timeout(2_000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function sandboxVersion(sandbox: Sandbox): Promise<string> {
  const stream = await sandbox.readFile({ path: `${GAME_DIR}/VERSION` });
  if (!stream) return "";
  let text = "";
  for await (const chunk of stream) text += chunk.toString();
  return text.trim();
}

/**
 * A sandbox keeps whatever game it was given, so before starting it, bring it
 * up to this deployment's build. Only a new session pays for the upload, and
 * only once per deploy.
 */
async function syncGame(sandbox: Sandbox): Promise<void> {
  const local = readFileSync(join(DIST, "VERSION"), "utf8").trim();
  if ((await sandboxVersion(sandbox)) === local) return;
  await sandbox.writeFiles(
    GAME_FILES.map((f) => ({
      path: `${GAME_DIR}/${f}`,
      content: readFileSync(join(DIST, f)),
    })),
  );
}

/** Starts the pty-server unless one already answers, then waits for it. */
export async function ensureGameRunning(
  sandbox: Sandbox,
  query: string,
): Promise<string> {
  const base = sandbox.domain(GAME_PORT);
  if (await healthy(base)) return base;
  await syncGame(sandbox);
  await sandbox.runCommand({
    cmd: "node",
    args: [`${GAME_DIR}/pty-server.js`],
    cwd: GAME_DIR,
    env: { GAME_QUERY: query, TS_ROGUE_SAVE_PATH: "/vercel/sandbox/save.db" },
    detached: true,
  });
  for (let i = 0; i < 40; i++) {
    if (await healthy(base)) return base;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("pty-server did not come up");
}
