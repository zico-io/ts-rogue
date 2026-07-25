import { describe, expect, it } from "vitest";
import type {
  DungeonLayout,
  DungeonState,
  DungeonTile,
} from "../../engine/world/types";
import {
  type BillboardSpriteHandle,
  type DungeonDrawFactory,
  DungeonSceneView,
  type WallColumnHandle,
} from "./dungeonView";
import type { RectHandle, TextHandle } from "./sceneView";

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

/** A no-op draw handle recording nothing but satisfying the interfaces; counts creations/destructions via the factory below. */
function fakeRect(): RectHandle {
  return {
    setPosition() {},
    setSize() {},
    setColor() {},
    destroy() {},
  };
}

function fakeWallColumn(): WallColumnHandle {
  return {
    setPosition() {},
    setSize() {},
    setTexel() {},
    setTint() {},
    destroy() {},
  };
}

function fakeBillboard(): BillboardSpriteHandle {
  return {
    setPosition() {},
    setSize() {},
    setTexture() {},
    setTint() {},
    destroy() {},
  };
}

function fakeText(initial: string): TextHandle {
  let text = initial;
  return {
    setPosition() {},
    setText(value: string) {
      text = value;
    },
    setColor() {},
    get width() {
      return text.length * 6;
    },
    get height() {
      return 14;
    },
    destroy() {},
  };
}

interface Counts {
  rects: number;
  rectDestroys: number;
  columns: number;
  columnDestroys: number;
  billboards: number;
  billboardDestroys: number;
}

function createFakeFactory(): { factory: DungeonDrawFactory; counts: Counts } {
  const counts: Counts = {
    rects: 0,
    rectDestroys: 0,
    columns: 0,
    columnDestroys: 0,
    billboards: 0,
    billboardDestroys: 0,
  };
  const factory: DungeonDrawFactory = {
    createRect() {
      counts.rects++;
      const handle = fakeRect();
      return {
        ...handle,
        destroy: () => {
          counts.rectDestroys++;
          handle.destroy();
        },
      };
    },
    createWallColumn() {
      counts.columns++;
      const handle = fakeWallColumn();
      return {
        ...handle,
        destroy: () => {
          counts.columnDestroys++;
          handle.destroy();
        },
      };
    },
    createBillboardSprite() {
      counts.billboards++;
      const handle = fakeBillboard();
      return {
        ...handle,
        destroy: () => {
          counts.billboardDestroys++;
          handle.destroy();
        },
      };
    },
    createText(initial: string) {
      return fakeText(initial);
    },
  };
  return { factory, counts };
}

describe("DungeonSceneView", () => {
  it("renders without crashing for a plain room", () => {
    const { factory } = createFakeFactory();
    const view = new DungeonSceneView(factory);
    const ds = buildState(buildRoomLayout(9, 9), { x: 4, y: 4 });
    expect(() => view.render(ds, { width: 200, height: 150 })).not.toThrow();
  });

  it("reuses the same wall-column handles across renders instead of recreating them", () => {
    const { factory, counts } = createFakeFactory();
    const view = new DungeonSceneView(factory);
    const ds = buildState(buildRoomLayout(9, 9), { x: 4, y: 4 });

    view.render(ds, { width: 200, height: 150 });
    const afterFirst = counts.columns;
    expect(afterFirst).toBeGreaterThan(0);

    view.render(ds, { width: 200, height: 150 });
    expect(counts.columns).toBe(afterFirst); // no new column sprites created
    expect(counts.columnDestroys).toBe(0); // and none destroyed - same viewport size
  });

  it("prunes stale wall-column handles when the viewport shrinks", () => {
    const { factory, counts } = createFakeFactory();
    const view = new DungeonSceneView(factory);
    const ds = buildState(buildRoomLayout(9, 9), { x: 4, y: 4 });

    view.render(ds, { width: 400, height: 150 });
    const wide = counts.columns;
    view.render(ds, { width: 40, height: 150 });
    expect(counts.columnDestroys).toBeGreaterThan(0);
    expect(counts.columns).toBe(wide); // no new columns needed, only pruning
  });

  it("draws a billboard for an in-view chest and prunes it once out of range", () => {
    const layout = buildRoomLayout(9, 9);
    const tiles = layout.tiles.map((row) => row.map((tile) => ({ ...tile })));
    tiles[3][4] = { wall: false, feature: "chest" };
    const mutated: DungeonLayout = { ...layout, tiles };

    const { factory, counts } = createFakeFactory();
    const view = new DungeonSceneView(factory);

    const facingChest = buildState(mutated, { x: 4, y: 4 });
    view.render(facingChest, { width: 200, height: 150 });
    expect(counts.billboards).toBe(1);

    // Facing away (south) puts the chest behind the camera - it should be
    // culled and its handle pruned.
    const facingAway: DungeonState = { ...facingChest, facing: "south" };
    view.render(facingAway, { width: 200, height: 150 });
    expect(counts.billboardDestroys).toBe(1);
  });

  it("does not throw when the player's minimap window has no room to draw", () => {
    const { factory } = createFakeFactory();
    const view = new DungeonSceneView(factory);
    const ds = buildState(buildRoomLayout(3, 3), { x: 1, y: 1 });
    expect(() => view.render(ds, { width: 10, height: 10 })).not.toThrow();
  });

  it("includes the facing and cleared/boss status in the status line", () => {
    const { factory } = createFakeFactory();
    const view = new DungeonSceneView(factory);
    const seenTexts: string[] = [];
    const wrapped: DungeonDrawFactory = {
      ...factory,
      createText(initial: string) {
        const handle = fakeText(initial);
        return {
          ...handle,
          setText(value: string) {
            seenTexts.push(value);
            handle.setText(value);
          },
        };
      },
    };
    const view2 = new DungeonSceneView(wrapped);
    const ds: DungeonState = {
      ...buildState(buildRoomLayout(5, 5), { x: 2, y: 2 }),
      facing: "east",
      reachedBoss: true,
      cleared: true,
    };
    view2.render(ds, { width: 100, height: 100 });
    expect(seenTexts.at(-1)).toBe(
      "Facing east | boss room reached | dungeon cleared",
    );
    expect(view).toBeDefined();
  });

  it("shows the evac confirm prompt instead of the facing status line when confirmingExit is true (ENG-1)", () => {
    const { factory } = createFakeFactory();
    const seenTexts: string[] = [];
    const wrapped: DungeonDrawFactory = {
      ...factory,
      createText(initial: string) {
        const handle = fakeText(initial);
        return {
          ...handle,
          setText(value: string) {
            seenTexts.push(value);
            handle.setText(value);
          },
        };
      },
    };
    const view = new DungeonSceneView(wrapped);
    const ds = buildState(buildRoomLayout(5, 5), { x: 2, y: 2 });

    view.render(ds, { width: 100, height: 100 }, true);

    expect(seenTexts.at(-1)).toBe("Evac to the entrance? [y/n]");
  });
});
