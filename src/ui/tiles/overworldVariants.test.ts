import { describe, expect, it } from "vitest";
import type { OverworldMap, Tile } from "../../engine/world/types";
import {
  clusterScale,
  hasShore,
  landmarkScale,
  mountainTexture,
  sameNeighborCount,
  shoreSides,
} from "./overworldVariants";

function mapFrom(rows: string[]): OverworldMap {
  const codes: Record<string, Tile> = {
    g: "grass",
    f: "forest",
    m: "mountain",
    w: "water",
    v: "village",
    d: "dungeonEntrance",
  };
  const tiles = rows.map((row) => row.split("").map((c) => codes[c]));
  return {
    width: tiles[0].length,
    height: tiles.length,
    tiles,
    village: { x: 0, y: 0 },
    dungeonEntrances: [],
  };
}

describe("sameNeighborCount", () => {
  it("counts orthogonal neighbors sharing the same tile type", () => {
    const map = mapFrom(["gmg", "mmm", "gmg"]);
    expect(sameNeighborCount(map, 1, 1, "mountain")).toBe(4);
  });

  it("does not count diagonal neighbors", () => {
    const map = mapFrom(["mgg", "gmg", "ggm"]);

    expect(sameNeighborCount(map, 1, 1, "mountain")).toBe(0);
  });

  it("never counts out-of-bounds as a match", () => {
    const map = mapFrom(["m"]);
    expect(sameNeighborCount(map, 0, 0, "mountain")).toBe(0);
  });
});

describe("clusterScale", () => {
  it("is smallest for an isolated tile (0 same-type neighbors)", () => {
    expect(clusterScale(0)).toBeCloseTo(0.8, 5);
  });

  it("is largest for a tile surrounded on all 4 sides", () => {
    expect(clusterScale(4)).toBeCloseTo(1.3, 5);
  });

  it("grows monotonically with neighbor count", () => {
    const scales = [0, 1, 2, 3, 4].map(clusterScale);
    for (let i = 1; i < scales.length; i++) {
      expect(scales[i]).toBeGreaterThan(scales[i - 1]);
    }
  });
});

describe("shoreSides", () => {
  it("flags land-adjacent sides of a water tile", () => {
    const map = mapFrom(["gww", "www", "www"]);

    const sides = shoreSides(map, 1, 0);
    expect(sides).toEqual({
      north: false,
      east: false,
      south: false,
      west: true,
    });
  });

  it("returns no sides for a fully water-surrounded water tile", () => {
    const map = mapFrom(["www", "www", "www"]);
    expect(hasShore(shoreSides(map, 1, 1))).toBe(false);
  });

  it("returns no sides for a non-water tile", () => {
    const map = mapFrom(["ggg", "gwg", "ggg"]);
    expect(hasShore(shoreSides(map, 0, 0))).toBe(false);
  });

  it("treats out-of-bounds as non-land, not a shore", () => {
    const map = mapFrom(["w"]);
    expect(hasShore(shoreSides(map, 0, 0))).toBe(false);
  });
});

describe("mountainTexture", () => {
  it("picks the small crop for an isolated or lightly-neighbored mountain", () => {
    expect(mountainTexture(0)).toBe("mountainSmall");
    expect(mountainTexture(1)).toBe("mountainSmall");
  });

  it("picks the plain (medium) crop for a moderately clustered mountain", () => {
    expect(mountainTexture(2)).toBe("mountain");
    expect(mountainTexture(3)).toBe("mountain");
  });

  it("picks the large crop for a mountain surrounded on all 4 sides", () => {
    expect(mountainTexture(4)).toBe("mountainLarge");
  });
});

describe("landmarkScale", () => {
  it("is deterministic for the same coordinate", () => {
    expect(landmarkScale(4, 7)).toBe(landmarkScale(4, 7));
  });

  it("stays within the documented size range", () => {
    for (let x = 0; x < 20; x++) {
      for (let y = 0; y < 20; y++) {
        const scale = landmarkScale(x, y);
        expect(scale).toBeGreaterThanOrEqual(0.9);
        expect(scale).toBeLessThanOrEqual(1.15);
      }
    }
  });

  it("varies across different coordinates", () => {
    const scales = new Set<number>();
    for (let x = 0; x < 10; x++) scales.add(landmarkScale(x, 0));
    expect(scales.size).toBeGreaterThan(1);
  });
});
