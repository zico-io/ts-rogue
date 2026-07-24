/**
 * Loads the HUD's bitmap pixel font (ROG-64, art direction §5) - replaces the
 * inline `fontFamily: "monospace"` the shared chrome DrawFactory
 * (`pixiDrawFactory.ts`) used for every HUD text - and installs it as a Pixi
 * `BitmapFont` so the chrome's text is pre-rasterized once and read crisp at
 * integer scale, with none of a canvas `Text`'s per-frame browser
 * font-rendering drift.
 *
 * Font: Silkscreen by Jason Kottke (SIL Open Font License 1.1), vendored at
 * `public/fonts/Silkscreen-Regular.ttf` (license text alongside it in
 * `public/fonts/OFL.txt`) - a small, classic pixel bitmap font that reads
 * clearly at the HUD's text sizes without needing a full glyph-atlas
 * pipeline.
 *
 * `loadHudFont` is best-effort: a browser without `FontFace` support, or a
 * failed font fetch, logs and leaves `isHudFontReady()` false rather than
 * throwing - `pixiDrawFactory.ts` falls back to a plain canvas `Text` in
 * `monospace` in that case, so the HUD still renders.
 */
import { BitmapFontManager } from "pixi.js";

/** Bitmap font name installed with Pixi's font cache; pass as `style.fontFamily` to a `BitmapText`. */
export const HUD_FONT_FAMILY = "ts-rogue-hud";
const WEB_FONT_FAMILY = "Silkscreen";
const WEB_FONT_URL = "/fonts/Silkscreen-Regular.ttf";
/**
 * Install/request size in px. Every `BitmapText` created afterward should
 * request this same size so Pixi never has to rescale the baked glyph
 * bitmaps (rescaling still looks fine at integer multiples, but matching
 * sizes keeps every glyph pixel-perfect at 1x).
 */
export const HUD_FONT_SIZE = 14;

let ready = false;
let loading: Promise<void> | undefined;

/** Whether `loadHudFont` finished installing the bitmap font. */
export function isHudFontReady(): boolean {
  return ready;
}

/** Idempotent and concurrency-safe: safe to call from more than one boot path. */
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
        // White fill + dynamicFill lets every HUD text tint at runtime
        // (`style.fill` per instance) from one baked glyph texture instead
        // of baking a separate texture per theme color.
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
