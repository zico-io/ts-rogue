import { describe, expect, it } from "vitest";
import { footprintCells, footprintOf } from "./sources";

describe("footprintOf / footprintCells (ENG-8)", () => {
  it("defaults to a 1x1 footprint for a texture without `multiCell`", () => {
    expect(footprintOf("grass")).toEqual({ wide: 1, high: 1 });
    expect(footprintCells("grass")).toEqual([{ col: 0, row: 0 }]);
  });

  it("reports the declared footprint for a `multiCell` texture", () => {
    expect(footprintOf("multiCellFixture")).toEqual({ wide: 2, high: 2 });
  });

  it("enumerates every covered cell row-major, top-left first", () => {
    expect(footprintCells("multiCellFixture")).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 0, row: 1 },
      { col: 1, row: 1 },
    ]);
  });
});

describe("village texture (ENG-7)", () => {
  it("declares a 2x2 footprint so it draws as one settlement, not four repeats", () => {
    expect(footprintOf("village")).toEqual({ wide: 2, high: 2 });
  });
});
