/**
 * Browser boot flag parsing, kept free of DOM/Pixi dependencies so it is
 * unit-testable in isolation. Mirrors the terminal boot sequence in
 * `src/app.tsx` (`--seed=`, `--fresh`, `--dev`) but reads a URL query string
 * instead of `process.argv`.
 */
export interface BootFlags {
  seed: number;
  fresh: boolean;
  dev: boolean;
}

/** Parses `?seed=123&fresh&dev`-style query strings into {@link BootFlags}. */
export function parseBootFlags(search: string): BootFlags {
  const params = new URLSearchParams(search);
  const seedParam = params.get("seed");
  const parsedSeed = seedParam === null ? Number.NaN : Number(seedParam);
  const seed = Number.isFinite(parsedSeed) ? parsedSeed : Date.now();
  return {
    seed,
    fresh: params.has("fresh"),
    dev: params.has("dev"),
  };
}
