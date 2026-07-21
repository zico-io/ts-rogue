/**
 * Minimal Braille dot canvas for smooth sub-cell line drawing in the terminal.
 *
 * Each character cell (U+2800–U+28FF) is a 2x4 dot matrix, so drawing onto a
 * `dotW x dotH` boolean buffer and packing 2x4 blocks into Braille chars yields
 * 8x the resolution of a plain character grid - enough for smooth diagonal
 * wireframe rails. See `render.ts` for the dungeon usage.
 */

/** Bit value for a dot at cell-local `(col in {0,1}, row in {0,1,2,3})`. */
const DOT_BIT: readonly number[][] = [
  [0x01, 0x02, 0x04, 0x40], // left column, top->bottom
  [0x08, 0x10, 0x20, 0x80], // right column, top->bottom
];

/** `dotW * dotH` flat dot buffer, all off. `dotW`/`dotH` must be > 0. */
export function createDotCanvas(dotW: number, dotH: number): Uint8Array {
  return new Uint8Array(dotW * dotH);
}

/** Bresenham line between two dot coordinates; endpoints outside are clipped. */
export function plotLine(
  buf: Uint8Array,
  dotW: number,
  dotH: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const xEnd = Math.round(x1);
  const yEnd = Math.round(y1);
  const dx = Math.abs(xEnd - x);
  const dy = Math.abs(yEnd - y);
  const sx = x < xEnd ? 1 : -1;
  const sy = y < yEnd ? 1 : -1;
  let error = dx - dy;

  while (true) {
    if (x >= 0 && x < dotW && y >= 0 && y < dotH) buf[y * dotW + x] = 1;
    if (x === xEnd && y === yEnd) break;
    const twiceError = error * 2;
    if (twiceError > -dy) {
      error -= dy;
      x += sx;
    }
    if (twiceError < dx) {
      error += dx;
      y += sy;
    }
  }
}

/**
 * Pack the dot buffer into `dotH/4` rows of `dotW/2` Braille chars. Empty cells
 * become a regular space (not blank-braille U+2800) so downstream space-based
 * centering keeps working. `dotW`/`dotH` should be multiples of 2/4.
 */
export function packBraille(
  buf: Uint8Array,
  dotW: number,
  dotH: number,
): string[] {
  const cols = Math.floor(dotW / 2);
  const rows = Math.floor(dotH / 4);
  const out: string[] = [];
  for (let cr = 0; cr < rows; cr++) {
    let row = "";
    for (let cc = 0; cc < cols; cc++) {
      let mask = 0;
      for (let c = 0; c < 2; c++) {
        for (let r = 0; r < 4; r++) {
          if (buf[(cr * 4 + r) * dotW + (cc * 2 + c)]) mask |= DOT_BIT[c][r];
        }
      }
      row += mask === 0 ? " " : String.fromCharCode(0x2800 + mask);
    }
    out.push(row);
  }
  return out;
}
