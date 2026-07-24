/**
 * Loads the packed browser texture atlas through Pixi's `Assets` loader
 * (ROG-44). The atlas (`public/atlas/atlas.png` + `atlas.json`) is generated
 * by `scripts/build-atlas.ts` from the Urizen sheet, using the tile-sheet
 * coordinates in `src/ui/tiles/sources.ts` (`TILE_SOURCES`).
 *
 * `public/` (Vite's default static dir, resolved from `vite.config.ts`'s
 * `root: "src/web"`) is served as-is in dev and copied verbatim into
 * `dist/web`, so `/atlas/atlas.json` is a stable URL in both environments.
 */
import { Assets, type Spritesheet } from "pixi.js";

/** Bundle name registered with `Assets`; also the key the loaded spritesheet resolves under. */
export const ATLAS_BUNDLE = "atlas";

let bundleAdded = false;

/**
 * Registers (once) and loads the atlas bundle, returning the parsed
 * `Spritesheet`. Every atlas frame shares one `textureSource` (the packed
 * `atlas.png`), so nearest-neighbor filtering is set once here, at the
 * source, rather than relying on a draw factory's per-sprite assignment
 * (`pixiOverworldDrawFactory.ts`/`pixiDungeonDrawFactory.ts`) to hit it as a
 * side effect (ROG-63) - those per-sprite assignments are now defensive
 * no-ops.
 */
export async function loadAtlas(): Promise<Spritesheet> {
  if (!bundleAdded) {
    Assets.addBundle(ATLAS_BUNDLE, { atlas: "/atlas/atlas.json" });
    bundleAdded = true;
  }
  const bundle = await Assets.loadBundle(ATLAS_BUNDLE);
  const sheet = bundle.atlas as Spritesheet;
  sheet.textureSource.scaleMode = "nearest";
  return sheet;
}
