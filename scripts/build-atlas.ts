/**
 * Pack the browser (Pixi) texture atlas from the vendored Minifantasy sheets,
 * using the per-frame rects in `src/ui/tiles/sources.ts` (`TILE_SOURCES`) as the
 * single source of truth (ROG-68). Pixi loads one packed atlas and scales pixel
 * art at render time with nearest-neighbor filtering. (The terminal renderer is
 * pure ASCII and draws no tiles.)
 *
 * Frames pack at 8x8 - Minifantasy's native grid. Most frames crop an 8x8 tile
 * straight through; a few (the 2-tile tree, the multi-tile buildings, the
 * trimmed player sprite) crop a larger region and resize down to the 8x8 output
 * so every atlas frame is one uniform cell.
 *
 * Import-time palette-lock grade (ROG-67 art direction §2.4/WEB-1): after each
 * frame is cropped/resized, a modest `sharp` grade (warmer + a touch more
 * saturated, plus a small local-contrast bump) is baked into the atlas pixels
 * once here, rather than at render time, so terrain/props read distinctly at a
 * glance instead of blending into the raw Minifantasy source's flatter tones.
 * This is a grade, not a quantization pass - the source art stays recognizable.
 * Battler (Aekashics) import-time quantization is explicitly out of scope
 * (deferred to ROG-70, see `scripts/build-battlers.ts`); the whole-frame Pixi
 * `ColorMatrixFilter` grade in `src/web/render/colorGrade.ts` is what unifies
 * battlers with this graded world.
 *
 * Battle monster sprites are deliberately NOT in `TILE_SOURCES` - they're a
 * separate scale class loaded as individual Aekashics textures
 * (`src/web/battlers.ts`), not packed atlas tiles.
 *
 * Output: `src/web/public/atlas/atlas.png` + `atlas.json` (Pixi Spritesheet
 * hash format, https://pixijs.download/release/docs/spritesheet.Spritesheet.html).
 * Frame names match `TileName` ids.
 *
 * Run after changing TILE_SOURCES: pnpm tsx scripts/build-atlas.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { SHEETS, TILE_SOURCES, type TileName } from "../src/ui/tiles/sources";

const SHEET_DIR = fileURLToPath(new URL("../assets/minifantasy/", import.meta.url));
const OUT_DIR = fileURLToPath(
  new URL("../src/web/public/atlas/", import.meta.url),
);
/** Every frame ships at this size regardless of the source crop's resolution. */
const OUTPUT_TILE = 8;
/** Transparent gutter between packed frames so nearest-neighbor sampling never bleeds across a frame edge. */
const PADDING = 1;
const COLUMNS = 4;

/** Palette-lock grade knobs (ROG-67 §2.4) - kept modest so frames stay recognizable. */
const GRADE_SATURATION = 1.12;
const GRADE_BRIGHTNESS = 1.04;
/**
 * `.linear(a, b)`: output = input * a + b, a small local-contrast bump. Given
 * as one entry per RGBA channel (rather than a single scalar broadcast to
 * every channel) so the alpha channel passes through untouched - frames are
 * RGBA with a transparent surround (`PADDING`), and scaling alpha here would
 * risk nearest-neighbor sampling picking up a faint edge bleed.
 */
const GRADE_CONTRAST_SLOPE = [1.06, 1.06, 1.06, 1];
const GRADE_CONTRAST_OFFSET = [-4, -4, -4, 0];

const ATLAS_FRAMES = Object.keys(TILE_SOURCES) as TileName[];

interface AtlasFrame {
  frame: { x: number; y: number; w: number; h: number };
  sourceSize: { w: number; h: number };
  spriteSourceSize: { x: number; y: number; w: number; h: number };
}

/** Crops a frame's source rect, resizes it to the 8x8 output cell, and applies the palette-lock grade. */
async function extractFrame(name: TileName): Promise<Buffer> {
  const src = TILE_SOURCES[name];
  return sharp(`${SHEET_DIR}${SHEETS[src.sheet]}`)
    .extract({ left: src.x, top: src.y, width: src.w, height: src.h })
    .resize(OUTPUT_TILE, OUTPUT_TILE, { kernel: "nearest", fit: "fill" })
    .modulate({ saturation: GRADE_SATURATION, brightness: GRADE_BRIGHTNESS })
    .linear(GRADE_CONTRAST_SLOPE, GRADE_CONTRAST_OFFSET)
    .sharpen()
    .png()
    .toBuffer();
}

const cell = OUTPUT_TILE + PADDING * 2;
const rows = Math.ceil(ATLAS_FRAMES.length / COLUMNS);
const sheetWidth = COLUMNS * cell;
const sheetHeight = rows * cell;

mkdirSync(OUT_DIR, { recursive: true });

const frames: Record<string, AtlasFrame> = {};
const composites: { input: Buffer; left: number; top: number }[] = [];

for (let i = 0; i < ATLAS_FRAMES.length; i++) {
  const name = ATLAS_FRAMES[i];
  const col = i % COLUMNS;
  const row = Math.floor(i / COLUMNS);
  const left = col * cell + PADDING;
  const top = row * cell + PADDING;
  composites.push({ input: await extractFrame(name), left, top });
  frames[name] = {
    frame: { x: left, y: top, w: OUTPUT_TILE, h: OUTPUT_TILE },
    sourceSize: { w: OUTPUT_TILE, h: OUTPUT_TILE },
    spriteSourceSize: { x: 0, y: 0, w: OUTPUT_TILE, h: OUTPUT_TILE },
  };
}

await sharp({
  create: {
    width: sheetWidth,
    height: sheetHeight,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite(composites)
  .png()
  .toFile(`${OUT_DIR}atlas.png`);

const atlasJson = {
  frames,
  meta: {
    image: "atlas.png",
    format: "RGBA8888",
    size: { w: sheetWidth, h: sheetHeight },
    scale: "1",
  },
};
writeFileSync(`${OUT_DIR}atlas.json`, `${JSON.stringify(atlasJson, null, 2)}\n`);

console.log(
  `atlas.png (${sheetWidth}x${sheetHeight}), ${ATLAS_FRAMES.length} frames`,
);
