// Plain-JS config (not next.config.ts): the repo pins TypeScript 7 (the native
// "tsgo" preview), whose JS compiler API is incomplete, so Next.js cannot
// transpile a TypeScript config file with it. `withEve` works fine from `.mjs`.
//
// This Next.js app is the deployment HOST: it owns runtime routing and mounts the
// `eve` agent (repo-root `agent/`) at `/eve/v1/*` via `withEve` from `eve/next`.
// One Vercel project serves the game at `/` and eve under `/eve` - no merge script.
//   - Vercel: `withEve` writes a Build Output `eve` service plus a route that sends
//     `/eve/v1/**` to it before filesystem routing; Next stays the default app.
//   - Local: `withEve` boots `eve dev` beside `next dev`/`next start` and rewrites
//     `/eve/**` to it.
// Because Next now owns routing, this is NOT `output: "export"` (a static export
// can't express rewrites/services). The pages still prerender to static HTML.
//
// Type-checking and linting stay owned by the repository's single `pnpm check`
// (a `tsgo --noEmit` pass over both renderers plus Biome), so the Next build does
// not duplicate them - this also keeps `next build` from driving the repo's
// tsgo toolchain, which its type-checker cannot run.
import { withEve } from "eve/next";

/** @type {import("next").NextConfig} */
const config = {
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
};

// The eve agent lives at repo root (`agent/`), two levels up from `src/web`.
// An absolute path keeps eveRoot correct whether the build runs from the repo
// root (local `next build src/web`) or from `src/web` (Vercel Root Directory).
export default withEve(config, {
  eveRoot: new URL("../../agent", import.meta.url).pathname,
});
