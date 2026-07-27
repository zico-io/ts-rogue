export interface BootFlags {
  seed: number;
  fresh: boolean;
  dev: boolean;
}

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
