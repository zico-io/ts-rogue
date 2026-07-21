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
  lerpPose,
  MINIMAP_HEIGHT,
  MINIMAP_WIDTH,
  poseFromState,
  renderDungeonView,
  renderMinimap,
} from "./render";

const VP = { width: 60, height: 20 };
const TAU = 2 * Math.PI;

/** A cell is a Braille glyph (U+2800–U+28FF), i.e. drawn wireframe. */
function isBraille(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= 0x2800 && code <= 0x28ff;
}

describe("renderDungeonView", () => {
  it("returns exactly the requested viewport dimensions", () => {
    const ds = createInitialDungeonState(1234, "dungeon-0", 1);
    for (const [width, height] of [
      [60, 20],
      [120, 40],
      [24, 10],
      [3, 2],
    ] as const) {
      const rows = renderDungeonView(ds, { width, height });
      expect(rows).toHaveLength(height);
      for (const row of rows) expect(row).toHaveLength(width);
    }
  });

  it("emits only spaces and Braille (no NaN garbage, no ASCII line art)", () => {
    const ds = createInitialDungeonState(1234, "dungeon-0", 1);
    for (const ch of renderDungeonView(ds, VP).join("")) {
      expect(ch === " " || isBraille(ch)).toBe(true);
    }
  });

  it("is pure: the same state renders identically twice", () => {
    const ds = createInitialDungeonState(7, "dungeon-0", 2);
    expect(renderDungeonView(ds, VP)).toEqual(renderDungeonView(ds, VP));
  });

  it("draws a facing wall as long horizontal rails spanning the view", () => {
    // Full wall row two steps ahead: its top/bottom rails cross the frame.
    const layout = buildLayout([
      "#######",
      "#######",
      "#.....#",
      "#.....#",
      "#######",
    ]);
    const ds = buildState(layout, { x: 3, y: 3 }, "north");
    const rows = renderDungeonView(ds, VP);
    const maxRun = Math.max(...rows.map(brailleRun));
    expect(maxRun).toBeGreaterThanOrEqual(VP.width / 2);
  });

  it("keeps the vanishing region open down a long corridor", () => {
    // Corridor longer than MAX_DEPTH: the side rails converge toward the
    // center but the vanishing cells themselves stay dark (no back wall).
    const corridor = Array.from({ length: 11 }, (_, y) =>
      y === 0 ? "###" : "#.#",
    );
    const ds = buildState(buildLayout(corridor), { x: 1, y: 9 }, "north");
    const rows = renderDungeonView(ds, VP);
    const center = dotCount(rows.slice(9, 11).map((r) => r.slice(29, 31)));
    expect(center).toBe(0);
    expect(dotCount(rows)).toBeGreaterThan(0);
  });

  it("shows a side doorway as a change confined to that flank", () => {
    const closed = ["###", "#.#", "#.#", "#.#", "#.#", "###"];
    const open = ["###", "#.#", "#.#", "..#", "#.#", "###"];
    const at = (rowsAscii: string[]) =>
      renderDungeonView(
        buildState(buildLayout(rowsAscii), { x: 1, y: 5 }, "north"),
        VP,
      );
    const closedRows = at(closed);
    const openRows = at(open);
    const half = VP.width / 2;
    // The doorway is on the left: the left half must change...
    expect(openRows.map((r) => r.slice(0, half))).not.toEqual(
      closedRows.map((r) => r.slice(0, half)),
    );
    // ...and the untouched right wall must render identically.
    expect(openRows.map((r) => r.slice(half))).toEqual(
      closedRows.map((r) => r.slice(half)),
    );
  });

  it("occludes geometry behind a facing wall", () => {
    const behindOpen = buildLayout([
      "#####",
      "#...#",
      "#####",
      "#...#",
      "#...#",
      "#####",
    ]);
    const behindPillar = buildLayout([
      "#####",
      "##..#",
      "#####",
      "#...#",
      "#...#",
      "#####",
    ]);
    const player = { x: 2, y: 4 } as Point;
    expect(
      renderDungeonView(buildState(behindPillar, player, "north"), VP),
    ).toEqual(renderDungeonView(buildState(behindOpen, player, "north"), VP));
  });

  it("dithers far wall faces denser than near ones (depth shading)", () => {
    // One isolated pillar in a big open room; the same screen-center region
    // is strictly inside the pillar's face both near and far.
    const floor = Array.from({ length: 17 }, () => ".".repeat(17));
    const withPillar = floor.map((row, y) =>
      y === 7 ? `${row.slice(0, 8)}#${row.slice(9)}` : row,
    );
    const layout = buildLayout(withPillar);
    const centerFill = (playerY: number) => {
      const rows = renderDungeonView(
        buildState(layout, { x: 8, y: playerY }, "north"),
        VP,
      );
      return dotCount(rows.slice(9, 11).map((r) => r.slice(28, 32)));
    };
    const near = centerFill(9); // pillar 2 tiles ahead
    const far = centerFill(12); // pillar 5 tiles ahead
    expect(near).toBeGreaterThan(0); // some fill even up close
    expect(far).toBeGreaterThan(near * 2); // distance darkens the surface
  });

  it("renders at the map edge facing out-of-bounds without throwing", () => {
    const ds = buildState(buildLayout(["..", ".."]), { x: 0, y: 0 }, "north");
    const rows = renderDungeonView(ds, VP);
    expect(rows).toHaveLength(VP.height);
    expect(rows.join("").split("").some(isBraille)).toBe(true);
  });

  it("draws feature props as Braille wireframes at their cell", () => {
    const room = (center: string) => [
      "#####",
      "#...#",
      `#.${center}.#`,
      "#...#",
      "#...#",
      "#####",
    ];
    const at = (center: string) =>
      renderDungeonView(
        buildState(buildLayout(room(center)), { x: 2, y: 4 }, "north"),
        VP,
      );
    const empty = at(".");
    for (const feature of ["C", ">", "B"] as const) {
      const rows = at(feature);
      expect(rows).not.toEqual(empty); // prop visible two tiles ahead
      for (const ch of rows.join("")) {
        expect(ch === " " || isBraille(ch)).toBe(true); // drawn, not lettered
      }
    }
  });

  it("occludes a prop behind a facing wall", () => {
    const chest = ["#####", "#.C.#", "#####", "#...#", "#####"];
    const bare = ["#####", "#...#", "#####", "#...#", "#####"];
    const at = (ascii: string[]) =>
      renderDungeonView(
        buildState(buildLayout(ascii), { x: 2, y: 3 }, "north"),
        VP,
      );
    expect(at(chest)).toEqual(at(bare));
  });

  it("renders fractional mid-step and mid-turn camera poses", () => {
    const ds = createInitialDungeonState(1234, "dungeon-0", 1);
    const base = poseFromState(ds);
    for (const camera of [
      { ...base, angle: base.angle + Math.PI / 4 },
      { ...base, x: base.x + 0.5 },
      { ...base, y: base.y - 0.5, angle: base.angle + 0.3 },
    ]) {
      const rows = renderDungeonView(ds, VP, camera);
      expect(rows).toHaveLength(VP.height);
      for (const ch of rows.join("")) {
        expect(ch === " " || isBraille(ch)).toBe(true);
      }
    }
  });
});

describe("camera poses", () => {
  it("maps the four facings to their yaw angles", () => {
    const ds = createInitialDungeonState(1234, "dungeon-0", 1);
    const angles: Record<DungeonFacing, number> = {
      north: 0,
      east: Math.PI / 2,
      south: Math.PI,
      west: (3 * Math.PI) / 2,
    };
    for (const facing of ["north", "east", "south", "west"] as const) {
      const pose = poseFromState({ ...ds, facing });
      expect(pose).toEqual({
        x: ds.player.x,
        y: ds.player.y,
        angle: angles[facing],
      });
    }
  });

  it("interpolates position linearly and is exact at the endpoints", () => {
    const a = { x: 2, y: 3, angle: 0 };
    const b = { x: 3, y: 3, angle: 0 };
    expect(lerpPose(a, b, 0)).toEqual(a);
    expect(lerpPose(a, b, 1)).toEqual(b);
    expect(lerpPose(a, b, 0.5).x).toBeCloseTo(2.5);
  });

  it("takes the shortest arc across the 2π wrap (west -> north turns right)", () => {
    const west = { x: 0, y: 0, angle: (3 * Math.PI) / 2 };
    const north = { x: 0, y: 0, angle: 0 };
    const mid = lerpPose(west, north, 0.5);
    expect(mid.angle).toBeCloseTo((7 * Math.PI) / 4); // through NW, not SE
    const end = ((lerpPose(west, north, 1).angle % TAU) + TAU) % TAU;
    expect(end).toBeCloseTo(0);
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

/** Longest contiguous run of Braille chars in a row (wall-rail detector). */
function brailleRun(row: string): number {
  let best = 0;
  let run = 0;
  for (const ch of row) {
    run = isBraille(ch) ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

/** Total lit Braille dots across a string-grid region. */
function dotCount(rows: string[]): number {
  let total = 0;
  for (const row of rows) {
    for (const ch of row) {
      const code = ch.charCodeAt(0);
      if (code >= 0x2800 && code <= 0x28ff) {
        let bits = code - 0x2800;
        while (bits) {
          total += bits & 1;
          bits >>= 1;
        }
      }
    }
  }
  return total;
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
    cleared: false,
  };
}
