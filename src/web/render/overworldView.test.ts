import { describe, expect, it, vi } from "vitest";
import { newGame } from "../../engine/state/store";
import { generateOverworldMap } from "../../engine/world/overworld";
import type { OverworldMap, Tile } from "../../engine/world/types";
import { theme, toPixiColor } from "../../ui/theme";
import type {
  BlobHandle,
  MultiCellRegion,
  OverworldDrawFactory,
  SpriteHandle,
} from "./overworldView";
import {
  ambientParticleKind,
  isShimmerTile,
  needsMarkerPulse,
  needsPropShadow,
  OverworldSceneView,
} from "./overworldView";
import type { RectHandle } from "./sceneView";

interface FakeSprite extends SpriteHandle {
  setPosition: ReturnType<typeof vi.fn<(x: number, y: number) => void>>;
  setTexture: ReturnType<
    typeof vi.fn<(name: string, region?: MultiCellRegion) => void>
  >;
  setSize: ReturnType<typeof vi.fn<(width: number, height: number) => void>>;
  setTint: ReturnType<typeof vi.fn<(color: number) => void>>;
  destroy: ReturnType<typeof vi.fn<() => void>>;
}

interface FakeRect extends RectHandle {
  setPosition: ReturnType<typeof vi.fn<(x: number, y: number) => void>>;
  setSize: ReturnType<typeof vi.fn<(width: number, height: number) => void>>;
  setColor: ReturnType<typeof vi.fn<(color: number) => void>>;
  destroy: ReturnType<typeof vi.fn<() => void>>;
}

interface FakeBlob extends BlobHandle {
  setPosition: ReturnType<typeof vi.fn<(x: number, y: number) => void>>;
  setSize: ReturnType<typeof vi.fn<(width: number, height: number) => void>>;
  setColor: ReturnType<typeof vi.fn<(color: number) => void>>;
  setAlpha: ReturnType<typeof vi.fn<(alpha: number) => void>>;
  destroy: ReturnType<typeof vi.fn<() => void>>;
}

interface FakeFactory extends OverworldDrawFactory {
  sprites: FakeSprite[];
  rects: FakeRect[];
  blobs: FakeBlob[];
}

function fakeFactory(): FakeFactory {
  const sprites: FakeSprite[] = [];
  const rects: FakeRect[] = [];
  const blobs: FakeBlob[] = [];
  return {
    sprites,
    rects,
    blobs,
    createSprite(): SpriteHandle {
      const handle: FakeSprite = {
        setPosition: vi.fn(),
        setTexture: vi.fn(),
        setSize: vi.fn(),
        setTint: vi.fn(),
        destroy: vi.fn(),
      };
      sprites.push(handle);
      return handle;
    },
    createRect(): RectHandle {
      const handle: FakeRect = {
        setPosition: vi.fn(),
        setSize: vi.fn(),
        setColor: vi.fn(),
        destroy: vi.fn(),
      };
      rects.push(handle);
      return handle;
    },
    createBlob(): BlobHandle {
      const handle: FakeBlob = {
        setPosition: vi.fn(),
        setSize: vi.fn(),
        setColor: vi.fn(),
        setAlpha: vi.fn(),
        destroy: vi.fn(),
      };
      blobs.push(handle);
      return handle;
    },
  };
}

const SIZE = { width: 400, height: 300 };
const TILE_PX = 20;

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

describe("OverworldSceneView", () => {
  it("positions and textures a viewport sprite per cell, tinting the player's cell with the player color", () => {
    const factory = fakeFactory();
    const view = new OverworldSceneView(factory);
    const state = newGame(1);
    const map = generateOverworldMap(state.seed);

    view.render(state, map, SIZE, TILE_PX);

    expect(factory.sprites.length).toBeGreaterThan(0);
    const playerSprite = factory.sprites.find((sprite) =>
      sprite.setTexture.mock.calls.some((call) => call[0] === "player"),
    );
    expect(playerSprite).toBeDefined();
    expect(playerSprite?.setTint.mock.calls.at(-1)?.[0]).toBeGreaterThanOrEqual(
      0,
    );
    expect(playerSprite?.setPosition).toHaveBeenCalled();

    expect(playerSprite?.setSize).toHaveBeenCalledWith(TILE_PX, TILE_PX);
  });

  it("reuses sprite/rect handles across renders when the map and state are unchanged", () => {
    const factory = fakeFactory();
    const view = new OverworldSceneView(factory);
    const state = newGame(1);
    const map = generateOverworldMap(state.seed);

    view.render(state, map, SIZE, TILE_PX);
    const spriteCountAfterFirst = factory.sprites.length;
    const rectCountAfterFirst = factory.rects.length;

    view.render(state, map, SIZE, TILE_PX);
    expect(factory.sprites.length).toBe(spriteCountAfterFirst);
    expect(factory.rects.length).toBe(rectCountAfterFirst);
  });

  it("destroys sprites that fall outside a shrunk viewport", () => {
    const factory = fakeFactory();
    const view = new OverworldSceneView(factory);
    const state = newGame(1);
    const map = generateOverworldMap(state.seed);

    view.render(state, map, SIZE, TILE_PX);
    const spriteCountAfterFirst = factory.sprites.length;

    view.render(state, map, { width: 60, height: 60 }, TILE_PX);
    const destroyedCount = factory.sprites.filter(
      (sprite) => sprite.destroy.mock.calls.length > 0,
    ).length;
    expect(destroyedCount).toBeGreaterThan(0);
    expect(destroyedCount).toBeLessThan(spriteCountAfterFirst);
  });

  it("destroys sprites left behind when the player moves out of the previously covered range", () => {
    const factory = fakeFactory();
    const view = new OverworldSceneView(factory);
    const state = newGame(1);
    const map = generateOverworldMap(state.seed);

    view.render(state, map, SIZE, TILE_PX);

    const moved = {
      ...state,
      worldState: {
        ...state.worldState,
        player: { x: map.village.x + 10, y: map.village.y },
      },
    };
    view.render(moved, map, SIZE, TILE_PX);
    const destroyedCount = factory.sprites.filter(
      (sprite) => sprite.destroy.mock.calls.length > 0,
    ).length;
    expect(destroyedCount).toBeGreaterThan(0);
  });

  it("draws a shore fringe rect on a water tile bordering land (ROG-73)", () => {
    const factory = fakeFactory();
    const view = new OverworldSceneView(factory);
    const state = newGame(1);
    const map = mapFrom(["ggggg", "gwwwg", "gwwwg", "gwwwg", "ggggg"]);
    const positioned = {
      ...state,
      worldState: { ...state.worldState, player: { x: 0, y: 0 } },
    };

    view.render(positioned, map, SIZE, TILE_PX);

    const shoreColor = toPixiColor(theme.biome.shore);
    const shoreRects = factory.rects.filter((rect) =>
      rect.setColor.mock.calls.some((call) => call[0] === shoreColor),
    );
    expect(shoreRects.length).toBeGreaterThan(0);
  });

  it("draws no shore fringe for a water tile fully surrounded by water (ROG-73)", () => {
    const factory = fakeFactory();
    const view = new OverworldSceneView(factory);
    const state = newGame(1);
    const map = mapFrom(["wwwww", "wwwww", "wwwww", "wwwww", "wwwww"]);
    const positioned = {
      ...state,
      worldState: { ...state.worldState, player: { x: 0, y: 0 } },
    };

    view.render(positioned, map, SIZE, TILE_PX);

    const shoreColor = toPixiColor(theme.biome.shore);
    const shoreRects = factory.rects.filter((rect) =>
      rect.setColor.mock.calls.some((call) => call[0] === shoreColor),
    );
    expect(shoreRects.length).toBe(0);
  });

  it("scales a mountain tile larger the more same-type neighbors it has (ROG-73)", () => {
    const factory = fakeFactory();
    const view = new OverworldSceneView(factory);
    const state = newGame(1);

    const map = mapFrom(["mgggg", "ggmmm", "ggmmm", "ggmmm", "ggggg"]);
    const positioned = {
      ...state,
      worldState: { ...state.worldState, player: { x: 0, y: 4 } },
    };

    view.render(positioned, map, SIZE, TILE_PX);

    const isolated = factory.sprites[0 * 5 + 0];
    const clustered = factory.sprites[2 * 5 + 3];
    const isolatedSize = isolated.setSize.mock.calls.at(-1)?.[0] as number;
    const clusteredSize = clustered.setSize.mock.calls.at(-1)?.[0] as number;
    expect(clusteredSize).toBeGreaterThan(isolatedSize);
  });

  it("swaps to a differently-sized mountain crop by same-type neighbor count (ROG-73)", () => {
    const factory = fakeFactory();
    const view = new OverworldSceneView(factory);
    const state = newGame(1);
    const map = mapFrom(["mgggg", "ggmmm", "ggmmm", "ggmmm", "ggggg"]);
    const positioned = {
      ...state,
      worldState: { ...state.worldState, player: { x: 0, y: 4 } },
    };

    view.render(positioned, map, SIZE, TILE_PX);

    const isolated = factory.sprites[0 * 5 + 0];
    const clustered = factory.sprites[2 * 5 + 3];
    expect(isolated.setTexture.mock.calls.at(-1)?.[0]).toBe("mountainSmall");
    expect(clustered.setTexture.mock.calls.at(-1)?.[0]).toBe("mountainLarge");
  });

  it("sizes the encounter meter's fill rect proportionally to encounterMeter/ENCOUNTER_THRESHOLD", () => {
    const factory = fakeFactory();
    const view = new OverworldSceneView(factory);
    const state = newGame(1);
    const map = generateOverworldMap(state.seed);

    const halfway = {
      ...state,
      worldState: { ...state.worldState, encounterMeter: 50 },
    };
    view.render(halfway, map, SIZE, TILE_PX);

    const meterBg = factory.rects.at(-2);
    const meterFill = factory.rects.at(-1);
    const bgWidth = meterBg?.setSize.mock.calls.at(-1)?.[0] as number;
    const fillWidth = meterFill?.setSize.mock.calls.at(-1)?.[0] as number;
    expect(fillWidth).toBeCloseTo(bgWidth * 0.5, 0);
  });

  it("grows the fill rect toward the background's full width as the meter approaches the threshold", () => {
    const factory = fakeFactory();
    const view = new OverworldSceneView(factory);
    const state = newGame(1);
    const map = generateOverworldMap(state.seed);

    const nearlyFull = {
      ...state,
      worldState: { ...state.worldState, encounterMeter: 100 },
    };
    view.render(nearlyFull, map, SIZE, TILE_PX);

    const meterBg = factory.rects.at(-2);
    const meterFill = factory.rects.at(-1);
    const bgWidth = meterBg?.setSize.mock.calls.at(-1)?.[0] as number;
    const fillWidth = meterFill?.setSize.mock.calls.at(-1)?.[0] as number;
    expect(fillWidth).toBeCloseTo(bgWidth, 0);
  });

  it("draws a multi-cell fixture as one continuous image - one sprite per covered cell, each its own sub-region, contiguous and non-overlapping (ENG-8)", () => {
    const factory = fakeFactory();
    const view = new OverworldSceneView(factory);
    const state = newGame(1);
    const map = generateOverworldMap(state.seed);

    view.render(state, map, SIZE, TILE_PX, {
      name: "multiCellFixture",
      originCol: 1,
      originRow: 1,
    });

    const footprintSprites = factory.sprites.filter((sprite) =>
      sprite.setTexture.mock.calls.some(
        (call) => call[0] === "multiCellFixture",
      ),
    );

    expect(footprintSprites).toHaveLength(4);

    const placements = footprintSprites.map((sprite) => ({
      region: sprite.setTexture.mock.calls.at(-1)?.[1] as MultiCellRegion,
      position: sprite.setPosition.mock.calls.at(-1) as [number, number],
      size: sprite.setSize.mock.calls.at(-1) as [number, number],
    }));

    for (const placement of placements) {
      expect(placement.region.wide).toBe(2);
      expect(placement.region.high).toBe(2);
      expect(placement.size).toEqual([TILE_PX, TILE_PX]);
    }
    const regionKeys = placements
      .map((p) => `${p.region.col},${p.region.row}`)
      .sort();
    expect(regionKeys).toEqual(["0,0", "0,1", "1,0", "1,1"]);

    const byRegion = new Map(
      placements.map((p) => [`${p.region.col},${p.region.row}`, p.position]),
    );
    const anchor = byRegion.get("0,0");
    expect(anchor).toBeDefined();
    if (!anchor) throw new Error("unreachable");
    expect(byRegion.get("1,0")).toEqual([anchor[0] + TILE_PX, anchor[1]]);
    expect(byRegion.get("0,1")).toEqual([anchor[0], anchor[1] + TILE_PX]);
    expect(byRegion.get("1,1")).toEqual([
      anchor[0] + TILE_PX,
      anchor[1] + TILE_PX,
    ]);
  });

  it("draws the generated village as one contiguous 2x2 footprint, not four repeated tiles (ENG-7)", () => {
    const factory = fakeFactory();
    const view = new OverworldSceneView(factory);
    const state = newGame(1);
    const map = generateOverworldMap(state.seed);
    const positioned = {
      ...state,
      worldState: {
        ...state.worldState,
        player: { x: map.village.x + 3, y: map.village.y + 3 },
      },
    };

    view.render(positioned, map, SIZE, TILE_PX);

    const villageSprites = factory.sprites.filter((sprite) =>
      sprite.setTexture.mock.calls.some((call) => call[0] === "village"),
    );
    expect(villageSprites).toHaveLength(4);

    const placements = villageSprites.map((sprite) => ({
      region: sprite.setTexture.mock.calls.at(-1)?.[1] as MultiCellRegion,
      position: sprite.setPosition.mock.calls.at(-1) as [number, number],
      size: sprite.setSize.mock.calls.at(-1) as [number, number],
    }));

    for (const placement of placements) {
      expect(placement.region).toBeDefined();
      expect(placement.region.wide).toBe(2);
      expect(placement.region.high).toBe(2);
      expect(placement.size).toEqual([TILE_PX, TILE_PX]);
    }
    const regionKeys = placements
      .map((p) => `${p.region.col},${p.region.row}`)
      .sort();
    expect(regionKeys).toEqual(["0,0", "0,1", "1,0", "1,1"]);

    const byRegion = new Map(
      placements.map((p) => [`${p.region.col},${p.region.row}`, p.position]),
    );
    const anchor = byRegion.get("0,0");
    expect(anchor).toBeDefined();
    if (!anchor) throw new Error("unreachable");
    expect(byRegion.get("1,0")).toEqual([anchor[0] + TILE_PX, anchor[1]]);
    expect(byRegion.get("0,1")).toEqual([anchor[0], anchor[1] + TILE_PX]);
    expect(byRegion.get("1,1")).toEqual([
      anchor[0] + TILE_PX,
      anchor[1] + TILE_PX,
    ]);
  });

  it("draws exactly one ground-shadow and one pulse halo for the whole village footprint, not one per covered cell (ENG-7)", () => {
    const factory = fakeFactory();
    const view = new OverworldSceneView(factory);
    const state = newGame(1);
    const map = generateOverworldMap(state.seed);
    const positioned = {
      ...state,
      worldState: {
        ...state.worldState,
        player: { x: map.village.x + 3, y: map.village.y + 3 },
      },
    };

    view.render(positioned, map, SIZE, TILE_PX);

    const shadowColor = toPixiColor(theme.background);
    const villageShadows = factory.blobs.filter(
      (blob) =>
        blob.setColor.mock.calls.some((call) => call[0] === shadowColor) &&
        blob.setAlpha.mock.calls.some((call) => call[0] === 0.32) &&
        blob.setSize.mock.calls.at(-1)?.[0] === TILE_PX * 2 * 0.62,
    );
    expect(villageShadows).toHaveLength(1);

    const villageColor = toPixiColor(theme.biome.village);
    const villagePulses = factory.blobs.filter((blob) =>
      blob.setColor.mock.calls.some((call) => call[0] === villageColor),
    );
    expect(villagePulses).toHaveLength(1);
  });

  it("draws a ground-shadow blob under the player marker and mountain/forest/village/dungeonEntrance props, but not under plain grass/water (ROG-65)", () => {
    const factory = fakeFactory();
    const view = new OverworldSceneView(factory);
    const state = newGame(1);
    const map = mapFrom(["vgggg", "gdggg", "ggmgg", "gggfg", "ggggw"]);
    const positioned = {
      ...state,
      worldState: { ...state.worldState, player: { x: 4, y: 0 } },
    };

    view.render(positioned, map, SIZE, TILE_PX);

    const shadowColor = toPixiColor(theme.background);
    const shadowBlobs = factory.blobs.filter(
      (blob) =>
        blob.setColor.mock.calls.some((call) => call[0] === shadowColor) &&
        blob.setAlpha.mock.calls.some((call) => call[0] === 0.32),
    );

    expect(shadowBlobs.length).toBe(5);
  });

  it("draws a breathing glow halo behind village/dungeonEntrance markers only (ROG-65)", () => {
    const factory = fakeFactory();
    const view = new OverworldSceneView(factory);
    const state = newGame(1);
    const map = mapFrom(["vgggg", "gdggg", "ggmgg", "gggfg", "ggggw"]);
    const positioned = {
      ...state,
      worldState: { ...state.worldState, player: { x: 4, y: 0 } },
    };

    view.render(positioned, map, SIZE, TILE_PX);

    const villageColor = toPixiColor(theme.biome.village);
    const dungeonColor = toPixiColor(theme.biome.dungeonEntrance);
    const pulseBlobs = factory.blobs.filter(
      (blob) =>
        blob.setColor.mock.calls.some(
          (call) => call[0] === villageColor || call[0] === dungeonColor,
        ) && !blob.setAlpha.mock.calls.some((call) => call[0] === 0.32),
    );
    expect(pulseBlobs.length).toBe(2);
  });

  it("ages the village/dungeonEntrance pulse halo's alpha over time via tick", () => {
    const factory = fakeFactory();
    const view = new OverworldSceneView(factory);
    const state = newGame(1);
    const map = mapFrom(["vg", "gg"]);
    const positioned = {
      ...state,
      worldState: { ...state.worldState, player: { x: 1, y: 1 } },
    };
    view.render(positioned, map, SIZE, TILE_PX);

    const villageColor = toPixiColor(theme.biome.village);
    const pulse = factory.blobs.find((blob) =>
      blob.setColor.mock.calls.some((call) => call[0] === villageColor),
    );
    expect(pulse).toBeDefined();
    const alphaCallsBefore = pulse?.setAlpha.mock.calls.length ?? 0;
    view.tick(500);
    expect(pulse?.setAlpha.mock.calls.length).toBeGreaterThan(alphaCallsBefore);
  });

  it("draws water shimmer blobs on the deterministic hash-selected subset of visible water tiles (ROG-65)", () => {
    const factory = fakeFactory();
    const view = new OverworldSceneView(factory);
    const state = newGame(1);
    const map = mapFrom(["wwwww", "wwwww", "wwwww", "wwwww", "wwwww"]);
    const positioned = {
      ...state,
      worldState: { ...state.worldState, player: { x: 0, y: 0 } },
    };

    view.render(positioned, map, SIZE, TILE_PX);

    const shimmerColor = toPixiColor(theme.biome.shimmer);
    const shimmerBlobs = factory.blobs.filter((blob) =>
      blob.setColor.mock.calls.some((call) => call[0] === shimmerColor),
    );

    let expectedCount = 0;
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        if (isShimmerTile(x, y)) expectedCount += 1;
      }
    }
    expect(expectedCount).toBeGreaterThan(0);
    expect(expectedCount).toBeLessThan(25);
    expect(shimmerBlobs.length).toBe(expectedCount);
  });

  it("spawns firefly-colored ambient particles but no leaf particles over a grass-only viewport (ROG-65)", () => {
    const factory = fakeFactory();
    const view = new OverworldSceneView(factory);
    const state = newGame(1);
    const map = mapFrom(["ggggg", "ggggg", "ggggg", "ggggg", "ggggg"]);
    const positioned = {
      ...state,
      worldState: { ...state.worldState, player: { x: 0, y: 0 } },
    };

    view.render(positioned, map, SIZE, TILE_PX);

    const fireflyColor = toPixiColor(theme.biome.firefly);
    const leafColor = toPixiColor(theme.biome.leaf);
    expect(
      factory.blobs.some((blob) =>
        blob.setColor.mock.calls.some((call) => call[0] === fireflyColor),
      ),
    ).toBe(true);
    expect(
      factory.blobs.some((blob) =>
        blob.setColor.mock.calls.some((call) => call[0] === leafColor),
      ),
    ).toBe(false);
  });

  it("spawns both leaf- and firefly-colored ambient particles once forest is visible (ROG-65)", () => {
    const factory = fakeFactory();
    const view = new OverworldSceneView(factory);
    const state = newGame(1);
    const map = mapFrom(["fgggg", "ggggg", "ggggg", "ggggg", "ggggg"]);
    const positioned = {
      ...state,
      worldState: { ...state.worldState, player: { x: 4, y: 4 } },
    };

    view.render(positioned, map, SIZE, TILE_PX);

    const fireflyColor = toPixiColor(theme.biome.firefly);
    const leafColor = toPixiColor(theme.biome.leaf);
    expect(
      factory.blobs.some((blob) =>
        blob.setColor.mock.calls.some((call) => call[0] === fireflyColor),
      ),
    ).toBe(true);
    expect(
      factory.blobs.some((blob) =>
        blob.setColor.mock.calls.some((call) => call[0] === leafColor),
      ),
    ).toBe(true);
  });

  it("spawns no ambient particles over a mountain/water-only viewport (ROG-65)", () => {
    const factory = fakeFactory();
    const view = new OverworldSceneView(factory);
    const state = newGame(1);
    const map = mapFrom(["mmwww", "mmwww", "mmwww", "mmwww", "mmwww"]);
    const positioned = {
      ...state,
      worldState: { ...state.worldState, player: { x: 0, y: 0 } },
    };

    view.render(positioned, map, SIZE, TILE_PX);

    const fireflyColor = toPixiColor(theme.biome.firefly);
    const leafColor = toPixiColor(theme.biome.leaf);
    expect(
      factory.blobs.some((blob) =>
        blob.setColor.mock.calls.some(
          (call) => call[0] === fireflyColor || call[0] === leafColor,
        ),
      ),
    ).toBe(false);
  });

  it("clears the ambient particle pool and freezes tick-driven alpha when reduced motion is enabled (ROG-65)", () => {
    const factory = fakeFactory();
    const view = new OverworldSceneView(factory);
    const state = newGame(1);
    const map = mapFrom(["ggggg", "ggggg", "ggggg", "ggggg", "ggggg"]);
    const positioned = {
      ...state,
      worldState: { ...state.worldState, player: { x: 0, y: 0 } },
    };
    view.render(positioned, map, SIZE, TILE_PX);

    const fireflyColor = toPixiColor(theme.biome.firefly);
    const ambientBlobs = factory.blobs.filter((blob) =>
      blob.setColor.mock.calls.some((call) => call[0] === fireflyColor),
    );
    expect(ambientBlobs.length).toBeGreaterThan(0);

    view.setReducedMotion(true);
    expect(
      ambientBlobs.every((blob) => blob.destroy.mock.calls.length > 0),
    ).toBe(true);

    const blobCountAfterClear = factory.blobs.length;
    view.tick(1000);

    expect(factory.blobs.length).toBe(blobCountAfterClear);
  });
});

describe("needsPropShadow", () => {
  it("is true for the player marker regardless of terrain", () => {
    expect(needsPropShadow("grass", true)).toBe(true);
    expect(needsPropShadow(undefined, true)).toBe(true);
  });

  it("is true for mountain/forest/village/dungeonEntrance props", () => {
    for (const tile of [
      "mountain",
      "forest",
      "village",
      "dungeonEntrance",
    ] as const) {
      expect(needsPropShadow(tile, false)).toBe(true);
    }
  });

  it("is false for grass/water when it isn't the player marker", () => {
    expect(needsPropShadow("grass", false)).toBe(false);
    expect(needsPropShadow("water", false)).toBe(false);
  });
});

describe("needsMarkerPulse", () => {
  it("is true only for village/dungeonEntrance", () => {
    expect(needsMarkerPulse("village")).toBe(true);
    expect(needsMarkerPulse("dungeonEntrance")).toBe(true);
    expect(needsMarkerPulse("grass")).toBe(false);
    expect(needsMarkerPulse("forest")).toBe(false);
    expect(needsMarkerPulse("mountain")).toBe(false);
    expect(needsMarkerPulse("water")).toBe(false);
    expect(needsMarkerPulse(undefined)).toBe(false);
  });
});

describe("ambientParticleKind", () => {
  it("is undefined when neither biome cue is present", () => {
    expect(ambientParticleKind(0, false, false)).toBeUndefined();
  });

  it("is leaf for every slot when only forest cover triggers it", () => {
    expect(ambientParticleKind(0, true, false)).toBe("leaf");
    expect(ambientParticleKind(1, true, false)).toBe("leaf");
  });

  it("is firefly for every slot when only grass/forest presence triggers it", () => {
    expect(ambientParticleKind(0, false, true)).toBe("firefly");
    expect(ambientParticleKind(1, false, true)).toBe("firefly");
  });

  it("alternates leaf/firefly by index parity when both cues are present", () => {
    expect(ambientParticleKind(0, true, true)).toBe("leaf");
    expect(ambientParticleKind(1, true, true)).toBe("firefly");
    expect(ambientParticleKind(2, true, true)).toBe("leaf");
  });
});

describe("isShimmerTile", () => {
  it("is a pure, deterministic function of tile coordinate", () => {
    expect(isShimmerTile(2, 2)).toBe(isShimmerTile(2, 2));
    expect(isShimmerTile(0, 0)).toBe(isShimmerTile(0, 0));
  });
});
