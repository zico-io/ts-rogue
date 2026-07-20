import { describe, expect, it } from "vitest";
import { generateOverworldMap } from "../../../engine/world/overworld.js";
import {
  buildMinimapRows,
  buildViewportRows,
  cameraOrigin,
  formatEncounterMeter,
} from "./render.js";

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
