import { describe, expect, it } from "vitest";
import {
  footprintCells,
  footprintFitsBounds,
  footprintIsClear,
  LANDMARK_FOOTPRINTS,
  paintFootprint,
} from "./landmarks";
import { isPassable } from "./overworld";
import type { Tile } from "./types";

describe("footprintCells", () => {
  it("enumerates every cell of a footprint anchored at its top-left corner", () => {
    const cells = footprintCells({ x: 3, y: 10 }, { width: 2, height: 2 });
    expect(cells).toEqual([
      { x: 3, y: 10 },
      { x: 4, y: 10 },
      { x: 3, y: 11 },
      { x: 4, y: 11 },
    ]);
  });

  it("is derived from anchor + size, not a stored list", () => {
    const a = footprintCells({ x: 0, y: 0 }, LANDMARK_FOOTPRINTS.village);
    const b = footprintCells({ x: 5, y: 5 }, LANDMARK_FOOTPRINTS.village);
    expect(b).toEqual(a.map((c) => ({ x: c.x + 5, y: c.y + 5 })));
  });
});

describe("footprintFitsBounds", () => {
  it("rejects a footprint that would spill past the map edge", () => {
    expect(
      footprintFitsBounds({ x: 9, y: 9 }, { width: 2, height: 2 }, 10, 10),
    ).toBe(false);
    expect(
      footprintFitsBounds({ x: 8, y: 8 }, { width: 2, height: 2 }, 10, 10),
    ).toBe(true);
  });

  it("rejects a negative anchor", () => {
    expect(
      footprintFitsBounds({ x: -1, y: 0 }, { width: 2, height: 2 }, 10, 10),
    ).toBe(false);
  });
});

function gridOf(rows: string[]): Tile[][] {
  const codes: Record<string, Tile> = {
    g: "grass",
    m: "mountain",
    v: "village",
    d: "dungeonEntrance",
  };
  return rows.map((row) => row.split("").map((c) => codes[c]));
}

describe("footprintIsClear", () => {
  it("is true when every covered cell is passable and unclaimed", () => {
    const tiles = gridOf(["gggg", "gggg", "gggg", "gggg"]);
    expect(
      footprintIsClear(
        tiles,
        { x: 1, y: 1 },
        { width: 2, height: 2 },
        isPassable,
      ),
    ).toBe(true);
  });

  it("is false when the footprint would overlap impassable terrain", () => {
    const tiles = gridOf(["gggg", "gmgg", "gggg", "gggg"]);
    expect(
      footprintIsClear(
        tiles,
        { x: 1, y: 1 },
        { width: 2, height: 2 },
        isPassable,
      ),
    ).toBe(false);
  });

  it("is false when the footprint would overlap an existing landmark", () => {
    const tiles = gridOf(["gggg", "gdgg", "gggg", "gggg"]);
    expect(
      footprintIsClear(
        tiles,
        { x: 1, y: 1 },
        { width: 2, height: 2 },
        isPassable,
      ),
    ).toBe(false);
  });

  it("is false when the footprint would spill outside the grid", () => {
    const tiles = gridOf(["gggg", "gggg", "gggg", "gggg"]);
    expect(
      footprintIsClear(
        tiles,
        { x: 3, y: 3 },
        { width: 2, height: 2 },
        isPassable,
      ),
    ).toBe(false);
  });
});

describe("paintFootprint", () => {
  it("paints every covered cell in place and leaves the rest untouched", () => {
    const tiles = gridOf(["gggg", "gggg", "gggg", "gggg"]);
    paintFootprint(tiles, { x: 1, y: 1 }, { width: 2, height: 2 }, "village");
    expect(tiles).toEqual(gridOf(["gggg", "gvvg", "gvvg", "gggg"]));
  });
});
