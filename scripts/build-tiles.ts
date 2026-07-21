/**
 * Slice the Urizen sheet into per-tile PNGs under assets/tiles/, one per
 * TILE_SOURCES entry. Terminals ignore kitty source rects on virtual
 * placements, so each tile must be its own image. Monster sprites are
 * pre-scaled x8 nearest-neighbor so the terminal never has to upscale
 * (linear upscaling blurs 1-bit pixel art).
 *
 * Run after changing TILE_SOURCES: pnpm tsx scripts/build-tiles.ts
 */
import { mkdirSync } from "node:fs";
import sharp from "sharp";
import {
  SPRITE_CELLS,
  TILE_SOURCES,
  type TileSource,
} from "../src/ui/tiles/kitty";

const SHEET = new URL("../assets/urizen_onebit_tileset__v2d0.png", import.meta.url)
  .pathname;
const OUT_DIR = new URL("../assets/tiles/", import.meta.url).pathname;
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
  await sharp(SHEET)
    .extract({
      left: 1 + PITCH * source.col,
      top: 1 + PITCH * source.row,
      width: TILE,
      height: TILE,
    })
    .resize(size, size, { kernel: "nearest" })
    .png()
    .toFile(`${OUT_DIR}${name}.png`);
  console.log(`${name}.png (${size}x${size})`);
}
