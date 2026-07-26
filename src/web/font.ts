import { BitmapFontManager } from "pixi.js";

export const HUD_FONT_FAMILY = "ts-rogue-hud";
const WEB_FONT_FAMILY = "Silkscreen";
const WEB_FONT_URL = "/fonts/Silkscreen-Regular.ttf";

export const HUD_FONT_SIZE = 14;

let ready = false;
let loading: Promise<void> | undefined;

export function isHudFontReady(): boolean {
  return ready;
}

export async function loadHudFont(): Promise<void> {
  if (ready) return;
  if (loading) return loading;
  loading = (async () => {
    try {
      const face = new FontFace(WEB_FONT_FAMILY, `url(${WEB_FONT_URL})`);
      await face.load();
      document.fonts.add(face);
      BitmapFontManager.install({
        name: HUD_FONT_FAMILY,
        style: {
          fontFamily: WEB_FONT_FAMILY,
          fontSize: HUD_FONT_SIZE,
          fill: 0xffffff,
        },
        chars: BitmapFontManager.ASCII,
        resolution: 2,

        dynamicFill: true,
        textureStyle: { scaleMode: "nearest" },
      });
      ready = true;
    } catch (error) {
      console.error("ts-rogue: failed to load HUD bitmap font", error);
    }
  })();
  return loading;
}
