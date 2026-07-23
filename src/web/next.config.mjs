// Plain-JS config (not next.config.ts): the repo pins TypeScript 7 (the native
// "tsgo" preview), whose JS compiler API is incomplete, so Next.js cannot
// transpile a TypeScript config file with it.
//
// The web chrome (ROG-54) is a fully client-side game - Pixi canvas, IndexedDB,
// keyboard - so Next.js is used purely as the app shell and static-site
// generator: `output: "export"` emits plain HTML/CSS/JS into `out/`, which
// `scripts/merge-web-into-eve-output.mjs` folds into the `eve` agent's Vercel
// Build Output exactly as the old Vite `dist/web` was. There is no Next server
// at runtime; `eve` still owns every function route.
//
// Type-checking and linting stay owned by the repository's single `pnpm check`
// (a `tsc --noEmit` pass over both renderers plus Biome), so the Next build does
// not duplicate them - this also keeps `next build` from driving the repo's
// tsgo toolchain, which its type-checker cannot run.

/** @type {import("next").NextConfig} */
const config = {
  output: "export",
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
};

export default config;
