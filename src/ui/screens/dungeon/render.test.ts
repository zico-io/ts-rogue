import { describe, expect, it } from "vitest";
import { createInitialDungeonState } from "../../../engine/world/dungeon";
import type {
  DungeonFacing,
  DungeonFeature,
  DungeonLayout,
  DungeonState,
  DungeonTile,
  Point,
} from "../../../engine/world/types";
import {
  FACING_GLYPH,
  FP_VIEW_HEIGHT,
  FP_VIEW_WIDTH,
  MINIMAP_HEIGHT,
  MINIMAP_WIDTH,
  renderDungeonView,
  renderMinimap,
} from "./render";

/** A cell is a Braille glyph (U+2800–U+28FF), i.e. drawn wireframe. */
function isBraille(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= 0x2800 && code <= 0x28ff;
}

/** The old ASCII wireframe glyphs must never appear in Braille output. */
const ASCII_WIREFRAME = ["\\", "/", "+", "|", "-", "#"];

describe("renderDungeonView", () => {
  it("returns FP_VIEW_HEIGHT rows of exactly FP_VIEW_WIDTH columns", () => {
    const ds = createInitialDungeonState(1234, "dungeon-0", 1);
    const rows = renderDungeonView(ds);
    expect(rows).toHaveLength(FP_VIEW_HEIGHT);
    for (const row of rows) expect(row).toHaveLength(FP_VIEW_WIDTH);
  });

  it("is pure: the same state renders identically twice", () => {
    const ds = createInitialDungeonState(7, "dungeon-0", 2);
    expect(renderDungeonView(ds)).toEqual(renderDungeonView(ds));
  });

  it("draws the wireframe as Braille and never as ASCII line glyphs", () => {
    const ds = createInitialDungeonState(1234, "dungeon-0", 1);
    const all = renderDungeonView(ds).join("");
    expect([...all].some(isBraille)).toBe(true); // wireframe present
    for (const ch of ASCII_WIREFRAME) expect(all).not.toContain(ch);
  });

  it("outlines the nearest wall as a dense Braille plane when a wall is directly ahead", () => {
    // player at (3,3) facing north; tile (3,2) is a wall one step ahead.
    const layout = buildLayout([
      "#######",
      "#.....#",
      "#..#..#",
      "#.....#",
      "#######",
    ]);
    const ds = buildState(layout, { x: 3, y: 3 }, "north");
    const rows = renderDungeonView(ds);
    // The front-wall rectangle draws long horizontal Braille runs (top/bottom
    // edges) that an open corridor never produces.
    const maxRun = Math.max(...rows.map(brailleRun));
    expect(maxRun).toBeGreaterThanOrEqual(15);
    for (const ch of ASCII_WIREFRAME) expect(rows.join("")).not.toContain(ch);
  });

  it("keeps the vanishing point open when the way is clear past view", () => {
    // 3-wide, 9-tall corridor; player at the bottom facing up a long hall.
    const layout = buildLayout([
      "###",
      "#.#",
      "#.#",
      "#.#",
      "#.#",
      "#.#",
      "#.#",
      "#.#",
      "###",
    ]);
    const ds = buildState(layout, { x: 1, y: 7 }, "north");
    const rows = renderDungeonView(ds);
    expect(rows[6][19]).toBe(" "); // vanishing point stays open
    expect(isBraille(rows[6][1])).toBe(true); // nearest left wall post drawn
    // No solid front wall: eye level has no long horizontal run spanning it.
    expect(brailleRun(rows[6])).toBeLessThan(15);
  });

  it("marks the far floor edge in an open room", () => {
    // Wide-open room, way clear ahead: a single floor line spans the room's
    // width at the far end of the visible space - just below eye level, never
    // above it - so the room reads as a floored space, not a void.
    const layout = buildLayout([
      "#######",
      "#.....#",
      "#.....#",
      "#.....#",
      "#.....#",
      "#.....#",
      "#.....#",
    ]);
    const rows = renderDungeonView(buildState(layout, { x: 3, y: 6 }, "north"));
    const maxRun = (slice: string[]) => Math.max(...slice.map(brailleRun));
    // The floor line is the longest horizontal run, and it sits below eye level.
    expect(maxRun(rows.slice(7))).toBeGreaterThan(maxRun(rows.slice(0, 6)));
  });

  it("renders the nearest interactable ahead as a glyph at the vanishing point", () => {
    const base = ["#####", "#.X.#", "#...#", "#####"];
    const player = { x: 2, y: 2 } as Point;
    for (const [glyph, feature] of [
      ["C", "C"],
      [">", ">"],
      ["B", "B"],
    ] as const) {
      const layout = buildLayout(base.map((row) => row.replace("X", feature)));
      const ds = buildState(layout, player, "north");
      expect(renderDungeonView(ds)[6][19]).toBe(glyph);
    }
  });

  it("reflects left/right wall presence on the player's own cell", () => {
    // player (1,3) facing north. Immediately left (west) (0,3) is floor -> a
    // passage the player can see into; immediately right (east) (2,3) is wall.
    const layout = buildLayout(["###", "#.#", "#.#", "..#"]);
    const ds = buildState(layout, { x: 1, y: 3 }, "north");
    const rows = renderDungeonView(ds);
    expect(rows[6][1]).toBe(" "); // nearest left post open (no left wall)
    expect(isBraille(rows[6][37])).toBe(true); // nearest right post closed
  });

  it("projects the back wall at the room's true width, so wider rooms read wider", () => {
    // Same wall two steps ahead, but a 1-wide corridor vs a 5-wide room. Side
    // walls are projected at their actual distance, so the room's back wall
    // spans far more of the frame than the corridor's narrow one.
    const brailleInBand = (rows: string[]) =>
      Math.max(...rows.slice(1, 5).map((r) => [...r].filter(isBraille).length));

    const corridor = renderDungeonView(
      buildState(buildLayout(["###", "#.#", "#.#"]), { x: 1, y: 2 }, "north"),
    );
    const room = renderDungeonView(
      buildState(
        buildLayout(["#####", "#...#", "#...#"]),
        { x: 2, y: 2 },
        "north",
      ),
    );
    expect(brailleInBand(room)).toBeGreaterThan(brailleInBand(corridor));
  });
});

describe("renderDungeonView (responsive)", () => {
  // A wall directly ahead fills the nearest frame with a solid back wall, so
  // the scaled output has a clear non-space bounding box to measure.
  const wallAheadLayout = buildLayout([
    "#######",
    "#.....#",
    "#..#..#",
    "#.....#",
    "#######",
  ]);
  const wallAheadDs = buildState(wallAheadLayout, { x: 3, y: 3 }, "north");

  it("returns exactly the requested viewport dimensions", () => {
    for (const [width, height] of [
      [60, 20],
      [120, 40],
      [24, 10],
    ] as const) {
      const rows = renderDungeonView(wallAheadDs, { width, height });
      expect(rows).toHaveLength(height);
      for (const row of rows) expect(row).toHaveLength(width);
    }
  });

  it("centers the scaled view within the viewport", () => {
    for (const [width, height] of [
      [60, 20],
      [120, 40],
      [24, 10],
    ] as const) {
      const rows = renderDungeonView(wallAheadDs, { width, height });
      const box = contentBox(rows);
      const leftMargin = box.minCol;
      const rightMargin = width - 1 - box.maxCol;
      const topMargin = box.minRow;
      const bottomMargin = height - 1 - box.maxRow;
      // Nearest-neighbor rounding can shift by one cell, so allow +/- 1.
      expect(Math.abs(leftMargin - rightMargin)).toBeLessThanOrEqual(1);
      expect(Math.abs(topMargin - bottomMargin)).toBeLessThanOrEqual(1);
    }
  });

  it("scales the frame up with a larger viewport", () => {
    const small = contentBox(
      renderDungeonView(wallAheadDs, { width: 24, height: 10 }),
    );
    const medium = contentBox(
      renderDungeonView(wallAheadDs, { width: 60, height: 20 }),
    );
    const large = contentBox(
      renderDungeonView(wallAheadDs, { width: 120, height: 40 }),
    );
    const smallWidth = small.maxCol - small.minCol + 1;
    const mediumWidth = medium.maxCol - medium.minCol + 1;
    const largeWidth = large.maxCol - large.minCol + 1;
    expect(smallWidth).toBeGreaterThan(0);
    expect(mediumWidth).toBeGreaterThan(smallWidth);
    expect(largeWidth).toBeGreaterThan(mediumWidth);
  });

  it("preserves the feature glyph through scaling", () => {
    const layout = buildLayout(["#####", "#.C.#", "#...#", "#####"]);
    const ds = buildState(layout, { x: 2, y: 2 }, "north");
    const rows = renderDungeonView(ds, { width: 80, height: 24 });
    expect(rows.some((row) => row.includes("C"))).toBe(true);
  });

  it("defaults to the canonical view when no viewport is given", () => {
    const rows = renderDungeonView(wallAheadDs);
    expect(rows).toHaveLength(FP_VIEW_HEIGHT);
    for (const row of rows) expect(row).toHaveLength(FP_VIEW_WIDTH);
  });
});

describe("renderMinimap", () => {
  it("returns MINIMAP_HEIGHT rows of exactly MINIMAP_WIDTH columns", () => {
    const ds = createInitialDungeonState(1234, "dungeon-0", 1);
    const rows = renderMinimap(ds);
    expect(rows).toHaveLength(MINIMAP_HEIGHT);
    for (const row of rows) expect(row).toHaveLength(MINIMAP_WIDTH);
  });

  it("centers the party facing glyph and shows revealed walls/floor around it", () => {
    const ds = createInitialDungeonState(1234, "dungeon-0", 1);
    const rows = renderMinimap(ds);
    const cx = Math.floor(MINIMAP_WIDTH / 2);
    const cy = Math.floor(MINIMAP_HEIGHT / 2);
    expect(rows[cy][cx]).toBe(FACING_GLYPH[ds.facing]);
    const all = rows.join("");
    expect(all).toContain("#"); // walls
    expect(all).toContain("."); // floor
    expect(all).toContain(" "); // unexplored (window is larger than the FOV)
  });

  it("leaves unexplored tiles blank and clamps the window at the map edge", () => {
    const ds = createInitialDungeonState(1234, "dungeon-0", 1);
    const cornered: DungeonState = {
      ...ds,
      player: { x: 0, y: 0 },
      facing: "east",
      explored: ds.layout.tiles.map((row) => row.map(() => true)),
    };
    const rows = renderMinimap(cornered);
    expect(rows[0][0]).toBe(FACING_GLYPH.east); // player clamped to top-left
  });

  it("glyphs chests, stairs, and the boss marker on explored tiles", () => {
    const layout = buildLayout([
      "#######",
      "#.C.>.#",
      "#.....#",
      "#..B..#",
      "#######",
    ]);
    const ds = buildState(layout, { x: 3, y: 2 }, "north");
    const rows = renderMinimap(ds);
    const all = rows.join("");
    expect(all).toContain("C");
    expect(all).toContain(">");
    expect(all).toContain("B");
  });
});

/** Longest contiguous run of Braille chars in a row (front-wall detector). */
function brailleRun(row: string): number {
  let best = 0;
  let run = 0;
  for (const ch of row) {
    run = isBraille(ch) ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

/** Bounding box of non-space characters in a string-grid. */
function contentBox(rows: string[]): {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
} {
  let minRow = -1;
  let maxRow = -1;
  let minCol = Number.POSITIVE_INFINITY;
  let maxCol = -1;
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      if (rows[y][x] !== " ") {
        if (minRow === -1) minRow = y;
        maxRow = y;
        minCol = Math.min(minCol, x);
        maxCol = Math.max(maxCol, x);
      }
    }
  }
  return { minRow, maxRow, minCol, maxCol };
}

/** Build a DungeonLayout from ASCII rows: `#` wall, `.` floor, `C`/`>`/`B` features. */
function buildLayout(rows: string[]): DungeonLayout {
  const height = rows.length;
  const width = rows[0].length;
  const tiles: DungeonTile[][] = rows.map((row) =>
    row.split("").map((ch): DungeonTile => {
      const wall = ch === "#";
      const feature: DungeonFeature =
        ch === "C"
          ? "chest"
          : ch === ">"
            ? "stairsDown"
            : ch === "B"
              ? "bossMarker"
              : "none";
      return { wall, feature };
    }),
  );
  return { width, height, tiles, entrance: { x: 0, y: 0 } };
}

/** Build a DungeonState for render tests; defaults to fully explored. */
function buildState(
  layout: DungeonLayout,
  player: Point,
  facing: DungeonFacing,
  explored?: boolean[][],
): DungeonState {
  const exp =
    explored ?? layout.tiles.map((row) => row.map((tile) => !tile.wall));
  return {
    dungeonId: "test",
    floor: 1,
    layout,
    player,
    facing,
    explored: exp,
    encounter: null,
    reachedBoss: false,
  };
}
