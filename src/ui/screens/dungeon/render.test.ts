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

  it("fills the nearest frame with a solid back wall when a wall is directly ahead", () => {
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
    expect(rows[0]).toBe(" ".repeat(FP_VIEW_WIDTH));
    expect(rows[6]).toBe(" ".repeat(8) + "#".repeat(23) + " ".repeat(8));
  });

  it("draws nested corridor frames with side walls when the way is open past view", () => {
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
    expect(rows[6][8]).toBe("|"); // nearest left wall edge
    expect(rows.every((row) => !row.includes("#"))).toBe(true); // no back wall
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

  it("reflects left/right wall presence on the nearest corridor slice", () => {
    // player (1,3) facing north: d=1 (1,2) is floor, d=2 (1,1) is a wall.
    // Left of the d=1 cell (0,2) is floor -> opening; right (2,2) is wall.
    const layout = buildLayout(["###", "###", "..#", "#.#"]);
    const ds = buildState(layout, { x: 1, y: 3 }, "north");
    const rows = renderDungeonView(ds);
    expect(rows[6][8]).toBe(" "); // nearest left edge open (no left wall)
    expect(rows[6][30]).toBe("|"); // nearest right edge closed (right wall)
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
