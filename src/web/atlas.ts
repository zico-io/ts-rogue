import { Assets, type Spritesheet } from "pixi.js";

export const ATLAS_BUNDLE = "atlas";

let bundleAdded = false;

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
