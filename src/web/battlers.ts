/**
 * Loads battle monster sprites through Pixi's `Assets` loader, one texture
 * per monster - the sibling of `atlas.ts`'s packed-atlas loader, but for the
 * front-facing Aekashics battlers (ROG-68/`src/web/ART_DIRECTION.md` §2.1).
 *
 * Battlers are a separate scale class from the 8x8 tile atlas: large,
 * individually-drawn front-view sprites, not packed frames sharing one grid.
 * `scripts/build-battlers.ts` copies the vendored source art
 * (`assets/aekashics/*.png`) into `public/battlers/`, so each URL below is
 * stable in both dev and the built `dist/web`, mirroring how `atlas.ts`
 * resolves `/atlas/atlas.json`.
 *
 * Keys match `MonsterDef.sprite` ids in `src/data/monsters.ts`. The terminal
 * renderer is unaffected - it draws these same three monsters from the
 * Urizen-sourced `TILE_SOURCES` entries in `src/ui/tiles/kitty.ts`, keyed by
 * monster id rather than `MonsterDef.sprite`.
 */
import { Assets, type Texture } from "pixi.js";

/** Monster sprite id -> served battler PNG URL. */
export const BATTLER_SOURCES: Record<string, string> = {
  slime: "/battlers/slime.png",
  goblin: "/battlers/goblin.png",
  "dungeon-guardian": "/battlers/dungeon-guardian.png",
};

/** Loads every known battler texture in parallel, nearest-neighbor filtered for crisp upscaling. */
export async function loadBattlerTextures(): Promise<Record<string, Texture>> {
  const entries = await Promise.all(
    Object.entries(BATTLER_SOURCES).map(async ([name, url]) => {
      const texture = await Assets.load<Texture>(url);
      texture.source.scaleMode = "nearest";
      return [name, texture] as const;
    }),
  );
  return Object.fromEntries(entries);
}
