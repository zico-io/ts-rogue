import { describe, expect, it } from "vitest";
import { generateOverworldMap } from "../../../engine/world/overworld";
import {
  buildMinimapRows,
  buildViewportRows,
  cameraOrigin,
  formatEncounterMeter,
} from "./render";

describe("cameraOrigin", () => {
  it("centers the viewport on the focus point away from the edges", () => {
    expect(cameraOrigin(20, 21, 42)).toBe(20 - 10);
  });

  it("clamps to the map's left/top edge", () => {
    expect(cameraOrigin(0, 21, 42)).toBe(0);
    expect(cameraOrigin(3, 21, 42)).toBe(0);
  });

  it("clamps to the map's right/bottom edge", () => {
    expect(cameraOrigin(41, 21, 42)).toBe(42 - 21);
  });
});

describe("buildViewportRows", () => {
  it("marks the player's own cell with the player glyph", () => {
    const map = generateOverworldMap(1);
    const rows = buildViewportRows(map, map.village);
    const originX = cameraOrigin(map.village.x, 21, map.width);
    const originY = cameraOrigin(map.village.y, 11, map.height);
    const cell = rows[map.village.y - originY][map.village.x - originX];
    expect(cell.char).toBe("@");
  });

  it("defaults to the 21x11 camera viewport when no size is given", () => {
    const map = generateOverworldMap(1);
    const rows = buildViewportRows(map, map.village);
    expect(rows).toHaveLength(11);
    for (const row of rows) expect(row).toHaveLength(21);
  });
});

describe("buildViewportRows (responsive)", () => {
  it("shrinks the window to the requested size", () => {
    const map = generateOverworldMap(1);
    const rows = buildViewportRows(map, map.village, { width: 10, height: 5 });
    expect(rows).toHaveLength(5);
    for (const row of rows) expect(row).toHaveLength(10);
  });

  it("grows the window up to the map size", () => {
    const map = generateOverworldMap(1);
    const rows = buildViewportRows(map, map.village, { width: 30, height: 15 });
    expect(rows).toHaveLength(15);
    for (const row of rows) expect(row).toHaveLength(30);
  });

  it("clamps a window larger than the map to the map bounds", () => {
    const map = generateOverworldMap(1);
    const rows = buildViewportRows(map, map.village, { width: 60, height: 30 });
    expect(rows).toHaveLength(map.height);
    for (const row of rows) expect(row).toHaveLength(map.width);
  });

  it("still marks the player at a custom viewport size", () => {
    const map = generateOverworldMap(1);
    const rows = buildViewportRows(map, map.village, { width: 30, height: 15 });
    const originX = cameraOrigin(map.village.x, 30, map.width);
    const originY = cameraOrigin(map.village.y, 15, map.height);
    const cell = rows[map.village.y - originY][map.village.x - originX];
    expect(cell.char).toBe("@");
  });

  it("never returns more rows/columns than the requested size", () => {
    const map = generateOverworldMap(2);
    for (const [width, height] of [
      [8, 4],
      [42, 21],
      [120, 40],
    ] as const) {
      const rows = buildViewportRows(map, map.village, { width, height });
      expect(rows.length).toBeLessThanOrEqual(height);
      for (const row of rows) expect(row.length).toBeLessThanOrEqual(width);
    }
  });
});

describe("buildMinimapRows", () => {
  it("keeps every dungeon entrance visible despite downsampling", () => {
    for (const seed of [1, 2, 3, 42]) {
      const map = generateOverworldMap(seed);
      const rows = buildMinimapRows(map, map.village);
      const glyphs = new Set(rows.flat().map((cell) => cell.char));
      expect(glyphs).toContain("D");
    }
  });

  it("defaults to the 3x downsampled overview when no options are given", () => {
    const map = generateOverworldMap(1);
    const rows = buildMinimapRows(map, map.village);
    expect(rows).toHaveLength(Math.ceil(map.height / 3));
    for (const row of rows) expect(row).toHaveLength(Math.ceil(map.width / 3));
  });
});

describe("buildMinimapRows (responsive)", () => {
  it("keeps the default size when the bounds are generous", () => {
    const map = generateOverworldMap(1);
    const rows = buildMinimapRows(map, map.village, {
      maxWidth: 30,
      maxHeight: 10,
    });
    expect(rows).toHaveLength(Math.ceil(map.height / 3));
    for (const row of rows) expect(row).toHaveLength(Math.ceil(map.width / 3));
  });

  it("downsamples more so the minimap fits within tight bounds", () => {
    const map = generateOverworldMap(1);
    const rows = buildMinimapRows(map, map.village, {
      maxWidth: 8,
      maxHeight: 4,
    });
    expect(rows.length).toBeLessThanOrEqual(4);
    for (const row of rows) expect(row.length).toBeLessThanOrEqual(8);
    // scale 6: ceil(42/6)=7 wide, ceil(21/6)=4 tall
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveLength(7);
  });

  it("honours an explicit scale of 1 for a full-size overview", () => {
    const map = generateOverworldMap(1);
    const rows = buildMinimapRows(map, map.village, { scale: 1 });
    expect(rows).toHaveLength(map.height);
    for (const row of rows) expect(row).toHaveLength(map.width);
  });

  it("honours an explicit scale of 2", () => {
    const map = generateOverworldMap(1);
    const rows = buildMinimapRows(map, map.village, { scale: 2 });
    expect(rows).toHaveLength(Math.ceil(map.height / 2));
    for (const row of rows) expect(row).toHaveLength(Math.ceil(map.width / 2));
  });

  it("still shows dungeon entrances at a shrunk scale", () => {
    const map = generateOverworldMap(1);
    const rows = buildMinimapRows(map, map.village, {
      maxWidth: 8,
      maxHeight: 4,
    });
    const glyphs = new Set(rows.flat().map((cell) => cell.char));
    expect(glyphs).toContain("D");
  });
});

describe("formatEncounterMeter", () => {
  it("renders an empty bar at zero", () => {
    expect(formatEncounterMeter(0, 100, 10)).toBe("[..........] 0%");
  });

  it("renders a full bar at the threshold", () => {
    expect(formatEncounterMeter(100, 100, 10)).toBe("[##########] 100%");
  });

  it("clamps above the threshold to 100%", () => {
    expect(formatEncounterMeter(150, 100, 10)).toBe("[##########] 100%");
  });

  it("renders a partial bar in between", () => {
    expect(formatEncounterMeter(50, 100, 10)).toBe("[#####.....] 50%");
  });
});
