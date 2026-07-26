import { describe, expect, it } from "vitest";
import { createDotCanvas, packBraille, plotLine } from "./braille";

describe("braille dot canvas", () => {
  it("packs a single dot to the low bit and empty cells to a space", () => {
    const buf = createDotCanvas(2, 4);
    buf[0] = 1;
    expect(packBraille(buf, 2, 4)).toEqual([String.fromCharCode(0x2801)]);
    expect(packBraille(createDotCanvas(2, 4), 2, 4)).toEqual([" "]);
  });

  it("packs a full 2x4 cell to the all-dots glyph", () => {
    const buf = createDotCanvas(2, 4);
    buf.fill(1);
    expect(packBraille(buf, 2, 4)).toEqual([String.fromCharCode(0x28ff)]);
  });

  it("plots a left-column line to the expected glyph", () => {
    const buf = createDotCanvas(2, 4);
    plotLine(buf, 2, 4, 0, 0, 0, 3);
    expect(packBraille(buf, 2, 4)).toEqual([String.fromCharCode(0x2847)]);
  });

  it("clips out-of-bounds endpoints instead of writing past the buffer", () => {
    const buf = createDotCanvas(2, 4);
    plotLine(buf, 2, 4, -5, -5, 0, 0);
    expect(packBraille(buf, 2, 4)).toEqual([String.fromCharCode(0x2801)]);
  });
});
