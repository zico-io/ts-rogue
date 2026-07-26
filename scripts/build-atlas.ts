/**
 * Pack the browser (Pixi) texture atlas from the vendored Minifantasy sheets,
 * using the per-frame rects in `src/ui/tiles/sources.ts` (`TILE_SOURCES`) as the
 * single source of truth (ROG-68). Pixi loads one packed atlas and scales pixel
 * art at render time with nearest-neighbor filtering. (The terminal renderer is
 * pure ASCII and draws no tiles.)
 *
 * Frames pack at 8x8 - Minifantasy's native grid - unless they declare
 * `multiCell` (ENG-8), in which case the output keeps that many 8x8 cells
 * (`wide*8 x high*8`) instead of squishing down to one. Everything else (the
 * 2-tile tree, the multi-tile buildings, the trimmed player sprite) still
 * crops a larger region and resizes down to the uniform 8x8 output cell, as
 * before. Frames pack into simple left-to-right, top-to-bottom shelves sized
 * to their own output dimensions rather than one fixed-size grid, since a
 * `multiCell` frame's cell no longer matches everything else's.
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
import {
  footprintOf,
  SHEETS,
  TILE_SOURCES,
  type TileName,
} from "../src/ui/tiles/sources";

const SHEET_DIR = fileURLToPath(new URL("../assets/minifantasy/", import.meta.url));
const OUT_DIR = fileURLToPath(
  new URL("../src/web/public/atlas/", import.meta.url),
);
/** Every frame ships in multiples of this size regardless of the source crop's resolution. */
const OUTPUT_TILE = 8;
/** Transparent gutter between packed frames so nearest-neighbor sampling never bleeds across a frame edge. */
const PADDING = 1;
const COLUMNS = 4;
/** Row-wrap budget for the shelf packer, matching the old fixed `COLUMNS`-wide grid's total width. */
const SHELF_WIDTH = COLUMNS * (OUTPUT_TILE + PADDING * 2);

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

/** Output pixel size for a frame: its declared `multiCell` footprint in 8px cells, or one uniform 8x8 cell. */
function outputSizeFor(name: TileName): { width: number; height: number } {
  const { wide, high } = footprintOf(name);
  return { width: wide * OUTPUT_TILE, height: high * OUTPUT_TILE };
}

/** Crops a frame's source rect, resizes it to its output size, and applies the palette-lock grade. */
async function extractFrame(
  name: TileName,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const src = TILE_SOURCES[name];
  const { width, height } = outputSizeFor(name);
  const buffer = await sharp(`${SHEET_DIR}${SHEETS[src.sheet]}`)
    .extract({ left: src.x, top: src.y, width: src.w, height: src.h })
    .resize(width, height, { kernel: "nearest", fit: "fill" })
    .modulate({ saturation: GRADE_SATURATION, brightness: GRADE_BRIGHTNESS })
    .linear(GRADE_CONTRAST_SLOPE, GRADE_CONTRAST_OFFSET)
    .sharpen()
    .png()
    .toBuffer();
  return { buffer, width, height };
}

mkdirSync(OUT_DIR, { recursive: true });

const frames: Record<string, AtlasFrame> = {};
const composites: { input: Buffer; left: number; top: number }[] = [];

// Shelf packer: place frames left-to-right, wrapping to a new row (as tall as
// the tallest frame placed on it) once a row would exceed `SHELF_WIDTH`. A
// fixed-size grid can't host a `multiCell` frame's bigger-than-uniform output
// next to everything else's 8x8 cells.
let cursorX = PADDING;
let cursorY = PADDING;
let rowHeight = 0;
let sheetWidth = 0;

for (const name of ATLAS_FRAMES) {
  const { buffer, width, height } = await extractFrame(name);
  if (cursorX > PADDING && cursorX + width + PADDING > SHELF_WIDTH) {
    cursorY += rowHeight + PADDING * 2;
    cursorX = PADDING;
    rowHeight = 0;
  }
  composites.push({ input: buffer, left: cursorX, top: cursorY });
  frames[name] = {
    frame: { x: cursorX, y: cursorY, w: width, h: height },
    sourceSize: { w: width, h: height },
    spriteSourceSize: { x: 0, y: 0, w: width, h: height },
  };
  sheetWidth = Math.max(sheetWidth, cursorX + width + PADDING);
  rowHeight = Math.max(rowHeight, height);
  cursorX += width + PADDING * 2;
}
const sheetHeight = cursorY + rowHeight + PADDING;

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
