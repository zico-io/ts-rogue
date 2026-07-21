/**
 * Slice the Urizen sheet into per-tile PNGs under assets/tiles/, one per
 * TILE_SOURCES entry. Terminals ignore kitty source rects on virtual
 * placements, so each tile must be its own image. The sheet's pure-black
 * background becomes transparent so the terminal background shows through.
 * Monster sprites are pre-scaled x8 nearest-neighbor so the terminal never
 * has to upscale (linear upscaling blurs 1-bit pixel art).
 *
 * Run after changing TILE_SOURCES: pnpm tsx scripts/build-tiles.ts
 */
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  SPRITE_CELLS,
  TILE_SOURCES,
  type TileSource,
} from "../src/ui/tiles/kitty";

const SHEET = fileURLToPath(
  new URL("../assets/urizen_onebit_tileset__v2d0.png", import.meta.url),
);
const OUT_DIR = fileURLToPath(new URL("../assets/tiles/", import.meta.url));
const TILE = 12;
const PITCH = 13;
const MONSTER_SCALE = 8;

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, source] of Object.entries(TILE_SOURCES) as [
  string,
  TileSource,
][]) {
  const isSprite = source.cells?.c === SPRITE_CELLS.width;
  const size = isSprite ? TILE * MONSTER_SCALE : TILE;
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
  await sharp(data, { raw: { width: TILE, height: TILE, channels: 4 } })
    .resize(size, size, { kernel: "nearest" })
    .png()
    .toFile(`${OUT_DIR}${name}.png`);
  console.log(`${name}.png (${size}x${size})`);
}
