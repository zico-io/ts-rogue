/**
 * Builds what goes into a player's sandbox: the game and the PTY host as two
 * single-file bundles, plus node-pty (native, so it cannot be bundled).
 *
 *   dist/app.js                   node dist/app.js --seed=1
 *   dist/pty-server.js            node dist/pty-server.js
 *   dist/node_modules/node-pty/   linux-x64 prebuild included
 *   dist/VERSION                  content hash; the session route uploads a
 *                                 newer app.js/pty-server.js into sandboxes
 *                                 whose VERSION differs
 */
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const WEB = fileURLToPath(new URL("..", import.meta.url));
const ROOT = join(WEB, "../..");
const DIST = join(WEB, "dist");
const require = createRequire(import.meta.url);

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  logLevel: "warning",
  // CommonJS dependencies (ws, node-pty's loader) call require() for builtins;
  // an ESM bundle has to hand them one.
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
} as const;

await build({
  ...common,
  entryPoints: [join(ROOT, "src/app.tsx")],
  outfile: join(DIST, "app.js"),
  // Ink imports React devtools behind a DEV check; the bundle must not carry it.
  alias: { "react-devtools-core": join(WEB, "scripts/empty.ts") },
});

await build({
  ...common,
  entryPoints: [join(WEB, "pty-server.ts")],
  outfile: join(DIST, "pty-server.js"),
  external: ["node-pty"],
});

cpSync(
  dirname(require.resolve("node-pty/package.json")),
  join(DIST, "node_modules/node-pty"),
  { recursive: true, dereference: true },
);
const hash = createHash("sha256");
for (const f of ["app.js", "pty-server.js"])
  hash.update(readFileSync(join(DIST, f)));
writeFileSync(join(DIST, "VERSION"), hash.digest("hex").slice(0, 12));
console.log(`bundled to ${DIST}`);
