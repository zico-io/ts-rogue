/**
 * Pack the browser (Pixi) texture atlas from the Urizen sheet, reusing the
 * same tile coordinates as the terminal's kitty tileset
 * (`src/ui/tiles/kitty.ts`) so both renderers draw from one source of truth
 * (ROG-44). Unlike the terminal pipeline - per-tile PNGs, monster sprites
 * pre-scaled 8x for glyph cells - Pixi loads one packed atlas and scales
 * pixel art at render time with nearest-neighbor filtering, so every frame
 * here stays at native 12x12.
 *
 * Output: `src/web/public/atlas/atlas.png` + `atlas.json` (Pixi Spritesheet
 * hash format, https://pixijs.download/release/docs/spritesheet.Spritesheet.html).
 * Frame names match `TileName`/`MonsterDef.sprite` ids.
 *
 * Run after changing ATLAS_FRAMES: pnpm tsx scripts/build-atlas.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { TILE_SOURCES, type TileName } from "../src/ui/tiles/kitty";

const SHEET = fileURLToPath(
  new URL("../assets/urizen_onebit_tileset__v2d0.png", import.meta.url),
);
const OUT_DIR = fileURLToPath(
  new URL("../src/web/public/atlas/", import.meta.url),
);
const TILE = 12;
const PITCH = 13;
/** Transparent gutter between packed frames so nearest-neighbor sampling never bleeds across a frame edge. */
const PADDING = 1;
const COLUMNS = 5;

/** First asset batch (ROG-44): overworld tiles, the player marker, and the monsters with battle sprites. */
const ATLAS_FRAMES: readonly TileName[] = [
  "grass",
  "forest",
  "mountain",
  "water",
  "village",
  "dungeonEntrance",
  "player",
  "slime",
  "goblin",
  "dungeon-guardian",
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

/** Crops one tile at native 12x12 and keys the sheet's pure-black background out as transparent. */
async function extractFrame(name: TileName): Promise<Buffer> {
  const source = TILE_SOURCES[name];
  const { data } = await sharp(SHEET)
    .extract({
      left: 1 + PITCH * source.col,
      top: 1 + PITCH * source.row,
      width: TILE,
      height: TILE,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0) {
      data[i + 3] = 0;
    }
  }
  return sharp(data, { raw: { width: TILE, height: TILE, channels: 4 } })
    .png()
    .toBuffer();
}

const cell = TILE + PADDING * 2;
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
    frame: { x: left, y: top, w: TILE, h: TILE },
    sourceSize: { w: TILE, h: TILE },
    spriteSourceSize: { x: 0, y: 0, w: TILE, h: TILE },
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
