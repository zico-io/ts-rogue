import { describe, expect, it } from "vitest";
import type {
  DungeonLayout,
  DungeonState,
  DungeonTile,
} from "../../engine/world/types";
import type { CameraPose } from "../../ui/screens/dungeon/render";
import {
  castBillboards,
  castWallColumns,
  TEXELS_PER_TILE,
} from "./dungeonRaycast";

/** A `width`x`height` room: floor everywhere, walls on the border. */
function buildRoomLayout(width: number, height: number): DungeonLayout {
  const tiles: DungeonTile[][] = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => ({
      wall: x === 0 || y === 0 || x === width - 1 || y === height - 1,
      feature: "none" as const,
    })),
  );
  return { width, height, tiles, entrance: { x: 1, y: 1 } };
}

function buildState(
  layout: DungeonLayout,
  player = layout.entrance,
): DungeonState {
  return {
    dungeonId: "dungeon-0",
    floor: 1,
    layout,
    player,
    facing: "north",
    explored: layout.tiles.map((row) => row.map(() => true)),
    encounter: null,
    reachedBoss: false,
    cleared: false,
  };
}

function pose(x: number, y: number, angle: number): CameraPose {
  return { x, y, angle };
}

describe("castWallColumns", () => {
  it("returns one column per ray, dense across the viewport", () => {
    const ds = buildState(buildRoomLayout(5, 5), { x: 2, y: 2 });
    const columns = castWallColumns(ds, pose(2, 2, 0), {
      width: 36,
      height: 100,
    });
    expect(columns).toHaveLength(9); // 36 / RAY_STRIP_PX(4) = 9
  });

  it("hits the north wall at the expected perpendicular distance facing north", () => {
    // 5x5 room, walls at the border; camera at the center tile (2,2) facing
    // north hits the wall at y=0, whose near face sits at real y=0.5 (tiles
    // are centered on their integer index - see the module doc comment).
    // Distance from y=2 is 2 - 0.5 = 1.5.
    const ds = buildState(buildRoomLayout(5, 5), { x: 2, y: 2 });
    const columns = castWallColumns(ds, pose(2, 2, 0), {
      width: 36,
      height: 100,
    });
    const center = columns[4]; // width/RAY_STRIP_PX=9 columns; index 4 has cameraX===0 exactly
    expect(center.distance).toBeCloseTo(1.5, 5);
    expect(center.side).toBe("ns");
  });

  it("hits the east wall at the expected perpendicular distance facing east", () => {
    const ds = buildState(buildRoomLayout(5, 5), { x: 2, y: 2 });
    const columns = castWallColumns(ds, pose(2, 2, Math.PI / 2), {
      width: 36,
      height: 100,
    });
    const center = columns[4];
    expect(center.distance).toBeCloseTo(1.5, 5);
    expect(center.side).toBe("ew");
  });

  it("reports no hit (Infinity distance, zero height) beyond MAX_DEPTH", () => {
    const ds = buildState(buildRoomLayout(40, 40), { x: 20, y: 20 });
    const columns = castWallColumns(ds, pose(20, 20, 0), {
      width: 36,
      height: 100,
    });
    for (const column of columns) {
      expect(column.distance).toBe(Number.POSITIVE_INFINITY);
      expect(column.top).toBe(column.bottom);
    }
  });

  it("produces a texel within [0, TEXELS_PER_TILE - 1] for an oblique hit", () => {
    const ds = buildState(buildRoomLayout(5, 5), { x: 2, y: 2 });
    const columns = castWallColumns(ds, pose(2, 2, 0), {
      width: 36,
      height: 100,
    });
    for (const column of columns) {
      if (Number.isFinite(column.distance)) {
        expect(column.texel).toBeGreaterThanOrEqual(0);
        expect(column.texel).toBeLessThan(TEXELS_PER_TILE);
      }
    }
  });

  it("shows nearer walls as taller (bigger on-screen) than farther ones", () => {
    const ds = buildState(buildRoomLayout(9, 9), { x: 1, y: 4 });
    const columns = castWallColumns(ds, pose(1, 4, Math.PI / 2), {
      width: 36,
      height: 100,
    });
    const center = columns[4];
    const near = castWallColumns(ds, pose(6, 4, Math.PI / 2), {
      width: 36,
      height: 100,
    })[4];
    expect(near.distance).toBeLessThan(center.distance);
    expect(near.bottom - near.top).toBeGreaterThan(center.bottom - center.top);
  });
});

describe("castBillboards", () => {
  it("projects a feature directly ahead to the screen's horizontal center", () => {
    const layout = buildRoomLayout(5, 5);
    // Mutate the north-of-player floor tile to carry a chest.
    const tiles = layout.tiles.map((row) => row.map((tile) => ({ ...tile })));
    tiles[1][2] = { wall: false, feature: "chest" };
    const mutatedLayout: DungeonLayout = { ...layout, tiles };
    const ds = buildState(mutatedLayout, { x: 2, y: 2 });
    const camera = pose(2, 2, 0);
    const viewport = { width: 100, height: 100 };
    const columns = castWallColumns(ds, camera, viewport);
    const billboards = castBillboards(ds, camera, viewport, columns);

    expect(billboards).toHaveLength(1);
    expect(billboards[0].feature).toBe("chest");
    expect(billboards[0].distance).toBeCloseTo(1, 5);
    expect(billboards[0].screenX).toBeCloseTo(50, 0);
  });

  it("culls a feature occluded by a nearer wall in the same direction", () => {
    // 1-wide east-west corridor: floor at y=1, x=1..5, walled at x=3 (a dead
    // end) with a chest placed past the wall at x=5. Facing east from (1,1),
    // the ray hits the x=3 wall (perp distance 1.0) well before the chest's
    // depth (~4), so the chest must be culled.
    const width = 7;
    const height = 3;
    const tiles: DungeonTile[][] = Array.from({ length: height }, (_, y) =>
      Array.from({ length: width }, (_, x) => ({
        wall: y !== 1 || x === 3,
        feature: "none" as const,
      })),
    );
    tiles[1][5] = { wall: false, feature: "chest" };
    const layout: DungeonLayout = {
      width,
      height,
      tiles,
      entrance: { x: 1, y: 1 },
    };
    const ds = buildState(layout, { x: 1, y: 1 });
    const camera = pose(1, 1, Math.PI / 2);
    const viewport = { width: 100, height: 100 };
    const columns = castWallColumns(ds, camera, viewport);
    const billboards = castBillboards(ds, camera, viewport, columns);

    expect(billboards).toHaveLength(0);
  });

  it("keeps a visible feature within an open corridor", () => {
    const width = 9;
    const height = 3;
    const tiles: DungeonTile[][] = Array.from({ length: height }, (_, y) =>
      Array.from({ length: width }, () => ({
        wall: y !== 1,
        feature: "none" as const,
      })),
    );
    tiles[1][6] = { wall: false, feature: "stairsDown" };
    const layout: DungeonLayout = {
      width,
      height,
      tiles,
      entrance: { x: 1, y: 1 },
    };
    const ds = buildState(layout, { x: 1, y: 1 });
    const camera = pose(1, 1, Math.PI / 2);
    const viewport = { width: 100, height: 100 };
    const columns = castWallColumns(ds, camera, viewport);
    const billboards = castBillboards(ds, camera, viewport, columns);

    expect(billboards).toHaveLength(1);
    expect(billboards[0].feature).toBe("stairsDown");
  });
});
