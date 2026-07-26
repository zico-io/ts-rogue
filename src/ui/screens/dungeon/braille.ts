const DOT_BIT: readonly number[][] = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
];

export function createDotCanvas(dotW: number, dotH: number): Uint8Array {
  return new Uint8Array(dotW * dotH);
}

export function plotLine(
  buf: Uint8Array,
  dotW: number,
  dotH: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  value = 1,
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
    if (x >= 0 && x < dotW && y >= 0 && y < dotH) buf[y * dotW + x] = value;
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

export interface BrailleRun {
  text: string;

  band: number;
}

export function packBrailleRuns(
  buf: Uint8Array,
  dotW: number,
  dotH: number,
): BrailleRun[][] {
  const cols = Math.floor(dotW / 2);
  const rows = Math.floor(dotH / 4);
  const out: BrailleRun[][] = [];
  for (let cr = 0; cr < rows; cr++) {
    const runs: BrailleRun[] = [];
    for (let cc = 0; cc < cols; cc++) {
      let mask = 0;
      let band = 0;
      for (let c = 0; c < 2; c++) {
        for (let r = 0; r < 4; r++) {
          const dot = buf[(cr * 4 + r) * dotW + (cc * 2 + c)];
          if (dot) {
            mask |= DOT_BIT[c][r];
            if (dot > band) band = dot;
          }
        }
      }
      const char = mask === 0 ? " " : String.fromCharCode(0x2800 + mask);
      const last = runs[runs.length - 1];
      if (last && (band === 0 || last.band === 0 || last.band === band)) {
        last.text += char;
        if (band > last.band) last.band = band;
      } else {
        runs.push({ text: char, band });
      }
    }
    out.push(runs);
  }
  return out;
}
