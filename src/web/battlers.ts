import { Assets, type Texture } from "pixi.js";

export const BATTLER_SOURCES: Record<string, string> = {
  slime: "/battlers/slime.png",
  goblin: "/battlers/goblin.png",
  "dungeon-guardian": "/battlers/dungeon-guardian.png",
};

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
