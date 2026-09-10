/**
 * Builds the base image: a sandbox snapshot holding node-pty (native, cannot
 * be bundled) at /vercel/sandbox/app/node_modules. The game itself is uploaded
 * by the session route from the deployed `dist/`, so this only needs rebuilding
 * when node-pty or the Node runtime changes. Run after `pnpm bundle`; put the
 * printed id in the web project's GAME_SNAPSHOT_ID.
 *
 * Auth: OIDC on Vercel, or VERCEL_TOKEN + VERCEL_TEAM_ID + VERCEL_PROJECT_ID.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Sandbox } from "@vercel/sandbox";
import { credentials, GAME_DIR } from "../lib/sandbox";

const DIST = fileURLToPath(new URL("../dist", import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

// node-pty only, and only the prebuild this VM can load.
const files = walk(join(DIST, "node_modules")).filter(
  (p) => !p.includes("/prebuilds/") || p.includes("/prebuilds/linux-x64/"),
);

const sandbox = await Sandbox.create({
  ...credentials(),
  runtime: "node24",
  timeout: 600_000,
});
try {
  await sandbox.mkDir(GAME_DIR);
  await sandbox.writeFiles(
    files.map((p) => ({
      path: `${GAME_DIR}/${relative(DIST, p)}`,
      content: readFileSync(p),
      mode: p.endsWith("spawn-helper") ? 0o755 : undefined,
    })),
  );
  // Prove the image works before freezing it: node-pty must load and the game must boot.
  const check = await sandbox.runCommand({
    cmd: "node",
    args: ["-e", "import('node-pty').then(() => console.log('node-pty ok'))"],
    cwd: GAME_DIR,
  });
  if (check.exitCode !== 0) throw new Error(await check.stderr());
  const snapshot = await sandbox.snapshot({ expiration: 0 });
  console.log(`GAME_SNAPSHOT_ID=${snapshot.snapshotId}`);
} finally {
  await sandbox.stop().catch(() => undefined);
}
