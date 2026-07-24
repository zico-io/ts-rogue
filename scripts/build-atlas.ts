/**
 * Pack the browser (Pixi) texture atlas from the Urizen sheet, using the
 * tile-sheet coordinates in `src/ui/tiles/sources.ts` (`TILE_SOURCES`) as the
 * single source of truth (ROG-44). Pixi loads one packed atlas and scales
 * pixel art at render time with nearest-neighbor filtering. (The terminal
 * renderer is pure ASCII and draws no tiles.)
 *
 * Frames pack at 8x8 (ROG-68) - the shared Minifantasy grid the hybrid asset
 * base (`src/web/ART_DIRECTION.md` §2.1) is migrating to - downsampled at
 * build time from the Urizen source, which is still native 12x12. This is an
 * interim step: no Minifantasy overworld/dungeon tile art was available to
 * import yet (see `assets/README.md`), so every frame below still comes from
 * Urizen; a follow-up ticket (ROG-62/ROG-65/ROG-69) swaps in real 8x8
 * Minifantasy sprites tile by tile without touching this grid math again.
 *
 * Battle monster sprites (slime/goblin/dungeon-guardian) are deliberately
 * NOT in `ATLAS_FRAMES` - they're a separate scale class loaded as individual
 * Aekashics textures (`src/web/battlers.ts`), not packed atlas tiles.
 *
 * Output: `src/web/public/atlas/atlas.png` + `atlas.json` (Pixi Spritesheet
 * hash format, https://pixijs.download/release/docs/spritesheet.Spritesheet.html).
 * Frame names match `TileName` ids.
 *
 * Run after changing ATLAS_FRAMES: pnpm tsx scripts/build-atlas.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { TILE_SOURCES, type TileName } from "../src/ui/tiles/sources";

const SHEET = fileURLToPath(
  new URL("../assets/urizen_onebit_tileset__v2d0.png", import.meta.url),
);
const OUT_DIR = fileURLToPath(
  new URL("../src/web/public/atlas/", import.meta.url),
);
/** Urizen source sheet's native tile size and pitch - unchanged, we crop the full tile then downsample. */
const SOURCE_TILE = 12;
const PITCH = 13;
/** Shared Minifantasy atlas grid (ROG-68): every frame ships at this size regardless of source resolution. */
const OUTPUT_TILE = 8;
/** Transparent gutter between packed frames so nearest-neighbor sampling never bleeds across a frame edge. */
const PADDING = 1;
const COLUMNS = 5;

/** First asset batch (ROG-44): overworld tiles, the player marker, and the dungeon-scene tile set. */
const ATLAS_FRAMES: readonly TileName[] = [
  "grass",
  "forest",
  "mountain",
  "water",
  "village",
  "dungeonEntrance",
  "player",
  // Dungeon first-person scene (ROG-50): wall/floor tiles and the three
  // billboarded feature markers (chest/stairs/boss), matching the TUI
  // renderer's minimap glyphs and the FP raycaster's wall texture.
  "wall",
  "floor",
  "chest",
  "stairsDown",
  "boss",
];

interface AtlasFrame {
  frame: { x: number; y: number; w: number; h: number };
  sourceSize: { w: number; h: number };
  spriteSourceSize: { x: number; y: number; w: number; h: number };
}

/** Crops one tile at native 12x12, keys the sheet's pure-black background out as transparent, then downsamples to the shared 8x8 output grid. */
async function extractFrame(name: TileName): Promise<Buffer> {
  const source = TILE_SOURCES[name];
  const { data } = await sharp(SHEET)
    .extract({
      left: 1 + PITCH * source.col,
      top: 1 + PITCH * source.row,
      width: SOURCE_TILE,
      height: SOURCE_TILE,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0) {
      data[i + 3] = 0;
    }
  }
  return sharp(data, {
    raw: { width: SOURCE_TILE, height: SOURCE_TILE, channels: 4 },
  })
    .resize(OUTPUT_TILE, OUTPUT_TILE, { kernel: "nearest" })
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
