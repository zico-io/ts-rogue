#!/usr/bin/env node
// Merges the Next.js static export (src/web/out) into eve's Vercel Build Output
// so one Vercel deployment serves both the eve agent and the PixiJS game:
//   /eve/v1/*, /.well-known/workflow/*  -> eve functions (unchanged)
//   /                                   -> the game's index.html (+ /_next/* assets)
//   everything else                     -> eve's static + __server fallback
//
// Run after `eve build` (which writes .vercel/output when VERCEL is set) and
// `pnpm web:build`. See vercel.json -> `vercel:build`.
//
// ponytail: this couples to eve's emitted route layout (a `filesystem` handle
// followed by explicit routes, including `/`->/index). If eve changes that,
// this throws loudly rather than deploying broken routing. Upgrade path is
// eve's first-class multi-build `services` in vercel.json.
import { existsSync } from "node:fs";
import { cp, readFile, writeFile } from "node:fs/promises";
import { strict as assert } from "node:assert";

const OUTPUT_DIR = ".vercel/output";
const CONFIG_PATH = `${OUTPUT_DIR}/config.json`;
const ROOT_ROUTE = { src: "/", dest: "/index.html" };

/**
 * Returns routes with the game claiming `/`. eve routes `/` to its own
 * `/index` function; a `/`->/index.html route placed immediately after the
 * `filesystem` handle is matched first and wins. Idempotent.
 */
export function withGameRootRoute(routes) {
  const fsIndex = routes.findIndex((route) => route.handle === "filesystem");
  if (fsIndex === -1) {
    throw new Error(
      "eve build output has no `filesystem` route handle; its routing layout changed - update this merge script.",
    );
  }
  if (routes.some((route) => route.src === "/" && route.dest === "/index.html")) {
    return routes;
  }
  return [...routes.slice(0, fsIndex + 1), ROOT_ROUTE, ...routes.slice(fsIndex + 1)];
}

function selftest() {
  const eveRoutes = [
    { handle: "filesystem" },
    { src: "/eve/v1/health", dest: "/eve/v1/health" },
    { src: "/", dest: "/index" },
    { src: "/(.*)", dest: "/__server" },
  ];
  const patched = withGameRootRoute(eveRoutes);
  // Game root route sits right after the filesystem handle, ahead of eve's `/`.
  assert.deepEqual(patched[1], ROOT_ROUTE);
  assert.ok(patched.indexOf(ROOT_ROUTE) < patched.findIndex((r) => r.dest === "/index"));
  // eve's function + catch-all routes are preserved.
  assert.ok(patched.some((r) => r.dest === "/eve/v1/health"));
  assert.ok(patched.some((r) => r.dest === "/__server"));
  // Idempotent.
  assert.equal(withGameRootRoute(patched).filter((r) => r.dest === "/index.html").length, 1);
  assert.throws(() => withGameRootRoute([{ src: "/x", dest: "/y" }]));
  console.log("merge-web-into-eve-output selftest passed");
}

async function main() {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(`${CONFIG_PATH} not found - run \`eve build\` (with VERCEL set) first.`);
  }
  if (!existsSync("src/web/out/index.html")) {
    throw new Error("src/web/out/index.html not found - run `pnpm web:build` first.");
  }
  // eve emits an empty static/ dir; the game's exported assets (index.html plus
  // the /_next/* bundle) slot in alongside it.
  await cp("src/web/out", `${OUTPUT_DIR}/static`, { recursive: true });

  const config = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  const routes = withGameRootRoute(config.routes ?? []);
  if (routes !== config.routes) {
    await writeFile(CONFIG_PATH, `${JSON.stringify({ ...config, routes }, null, 2)}\n`);
  }
  console.log("merged src/web/out into .vercel/output; `/` now serves the game.");
}

if (process.argv.includes("--selftest")) {
  selftest();
} else {
  await main();
}
