/**
 * Loads the packed browser texture atlas through Pixi's `Assets` loader
 * (ROG-44). The atlas (`public/atlas/atlas.png` + `atlas.json`) is generated
 * by `scripts/build-atlas.ts` from the Urizen sheet already used by the
 * terminal's kitty tileset (`src/ui/tiles/kitty.ts`) - same source art, same
 * frame names, so a sprite id resolves the same way in both renderers.
 *
 * `public/` (Vite's default static dir, resolved from `vite.config.ts`'s
 * `root: "src/web"`) is served as-is in dev and copied verbatim into
 * `dist/web`, so `/atlas/atlas.json` is a stable URL in both environments.
 */
import { Assets, type Spritesheet } from "pixi.js";

/** Bundle name registered with `Assets`; also the key the loaded spritesheet resolves under. */
export const ATLAS_BUNDLE = "atlas";

let bundleAdded = false;

/** Registers (once) and loads the atlas bundle, returning the parsed `Spritesheet`. */
export async function loadAtlas(): Promise<Spritesheet> {
  if (!bundleAdded) {
    Assets.addBundle(ATLAS_BUNDLE, { atlas: "/atlas/atlas.json" });
    bundleAdded = true;
  }
  const bundle = await Assets.loadBundle(ATLAS_BUNDLE);
  return bundle.atlas as Spritesheet;
}
