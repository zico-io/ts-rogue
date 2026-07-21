#!/usr/bin/env node
// Merges the vite web build (dist/web) into eve's Vercel Build Output so one
// Vercel deployment serves the eve agent, the PixiJS game, and the sandbox
// credential-broker proxy:
//   /eve/v1/*, /.well-known/workflow/*  -> eve functions (unchanged)
//   /api/proxy(/*)                      -> the sandbox credential broker
//   /                                   -> the game's index.html
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
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { strict as assert } from "node:assert";
import { build } from "esbuild";

const OUTPUT_DIR = ".vercel/output";
const CONFIG_PATH = `${OUTPUT_DIR}/config.json`;
const ROOT_ROUTE = { src: "/", dest: "/index.html" };

// The sandbox firewall forwards brokered egress here. One function handles
// every sub-path; `dest` selects it while the original URL is preserved for the
// OIDC audience check, like eve's own `__server` catch-all.
const PROXY_ENTRY = "agent/proxy.ts";
const PROXY_FUNC = `${OUTPUT_DIR}/functions/api/proxy.func`;
const PROXY_ROUTE = {
  src: "/api/proxy(?:/.*)?",
  dest: "/api/proxy",
};

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

/**
 * Returns routes with `/api/proxy(/*)` mapped to the broker function,
 * inserted right after the `filesystem` handle so it wins over eve's `__server`
 * catch-all. Idempotent.
 */
export function withProxyRoute(routes) {
  const fsIndex = routes.findIndex((route) => route.handle === "filesystem");
  if (fsIndex === -1) {
    throw new Error(
      "eve build output has no `filesystem` route handle; its routing layout changed - update this merge script.",
    );
  }
  if (routes.some((route) => route.dest === PROXY_ROUTE.dest)) {
    return routes;
  }
  return [
    ...routes.slice(0, fsIndex + 1),
    PROXY_ROUTE,
    ...routes.slice(fsIndex + 1),
  ];
}

// Bundle the broker into a self-contained Build Output Node function (deps
// inlined, so no node_modules tracing under the raw Build Output API).
async function buildProxyFunction() {
  await mkdir(PROXY_FUNC, { recursive: true });
  await build({
    entryPoints: [PROXY_ENTRY],
    outfile: `${PROXY_FUNC}/index.mjs`,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    // Let bundled CJS deps call `require` under ESM output.
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
  });
  await writeFile(
    `${PROXY_FUNC}/.vc-config.json`,
    `${JSON.stringify(
      {
        runtime: "nodejs22.x",
        handler: "index.mjs",
        launcherType: "Nodejs",
        shouldAddHelpers: false,
        supportsResponseStreaming: true,
      },
      null,
      2,
    )}\n`,
  );
}

function selftest() {
  const eveRoutes = [
    { handle: "filesystem" },
    { src: "/eve/v1/health", dest: "/eve/v1/health" },
    { src: "/", dest: "/index" },
    { src: "/(.*)", dest: "/__server" },
  ];
  const patched = withProxyRoute(withGameRootRoute(eveRoutes));
  const fsIdx = patched.findIndex((r) => r.handle === "filesystem");
  // Game root route is inserted after the filesystem handle, ahead of eve's `/`.
  const rootIdx = patched.findIndex((r) => r.src === "/" && r.dest === "/index.html");
  assert.ok(rootIdx > fsIdx);
  assert.ok(rootIdx < patched.findIndex((r) => r.dest === "/index"));
  // eve's function + catch-all routes are preserved.
  assert.ok(patched.some((r) => r.dest === "/eve/v1/health"));
  assert.ok(patched.some((r) => r.dest === "/__server"));
  // The proxy route sits after the filesystem handle and wins over eve's
  // `__server` catch-all.
  const proxyIdx = patched.findIndex((r) => r.dest === PROXY_ROUTE.dest);
  assert.ok(proxyIdx > fsIdx);
  assert.ok(proxyIdx < patched.findIndex((r) => r.dest === "/__server"));
  // Idempotent.
  assert.equal(withGameRootRoute(patched).filter((r) => r.dest === "/index.html").length, 1);
  assert.equal(
    withProxyRoute(patched).filter((r) => r.dest === PROXY_ROUTE.dest).length,
    1,
  );
  assert.throws(() => withGameRootRoute([{ src: "/x", dest: "/y" }]));
  assert.throws(() => withProxyRoute([{ src: "/x", dest: "/y" }]));
  console.log("merge-web-into-eve-output selftest passed");
}

async function main() {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(`${CONFIG_PATH} not found - run \`eve build\` (with VERCEL set) first.`);
  }
  if (!existsSync("dist/web/index.html")) {
    throw new Error("dist/web/index.html not found - run `pnpm web:build` first.");
  }
  // eve emits an empty static/ dir; the game's assets slot in alongside it.
  await cp("dist/web", `${OUTPUT_DIR}/static`, { recursive: true });

  await buildProxyFunction();

  const config = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  const routes = withProxyRoute(withGameRootRoute(config.routes ?? []));
  if (routes !== config.routes) {
    await writeFile(CONFIG_PATH, `${JSON.stringify({ ...config, routes }, null, 2)}\n`);
  }
  console.log(
    "merged dist/web + proxy into .vercel/output; `/` serves the game, /api/proxy brokers sandbox credentials.",
  );
}

if (process.argv.includes("--selftest")) {
  selftest();
} else {
  await main();
}
