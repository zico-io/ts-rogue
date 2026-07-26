import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  footprintOf,
  SHEETS,
  TILE_SOURCES,
  type TileName,
} from "../src/ui/tiles/sources";

const SHEET_DIR = fileURLToPath(
  new URL("../assets/minifantasy/", import.meta.url),
);
const OUT_DIR = fileURLToPath(
  new URL("../src/web/public/atlas/", import.meta.url),
);

const OUTPUT_TILE = 8;

const PADDING = 1;
const COLUMNS = 4;

const SHELF_WIDTH = COLUMNS * (OUTPUT_TILE + PADDING * 2);

const GRADE_SATURATION = 1.12;
const GRADE_BRIGHTNESS = 1.04;

const GRADE_CONTRAST_SLOPE = [1.06, 1.06, 1.06, 1];
const GRADE_CONTRAST_OFFSET = [-4, -4, -4, 0];

const ATLAS_FRAMES = Object.keys(TILE_SOURCES) as TileName[];

interface AtlasFrame {
  frame: { x: number; y: number; w: number; h: number };
  sourceSize: { w: number; h: number };
  spriteSourceSize: { x: number; y: number; w: number; h: number };
}

function outputSizeFor(name: TileName): { width: number; height: number } {
  const { wide, high } = footprintOf(name);
  return { width: wide * OUTPUT_TILE, height: high * OUTPUT_TILE };
}

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
writeFileSync(
  `${OUT_DIR}atlas.json`,
  `${JSON.stringify(atlasJson, null, 2)}\n`,
);

console.log(
  `atlas.png (${sheetWidth}x${sheetHeight}), ${ATLAS_FRAMES.length} frames`,
);
