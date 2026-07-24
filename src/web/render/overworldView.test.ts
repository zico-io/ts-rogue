import { describe, expect, it, vi } from "vitest";
import { newGame } from "../../engine/state/store";
import { generateOverworldMap } from "../../engine/world/overworld";
import type { OverworldDrawFactory, SpriteHandle } from "./overworldView";
import { OverworldSceneView } from "./overworldView";
import type { RectHandle } from "./sceneView";

interface FakeSprite extends SpriteHandle {
  setPosition: ReturnType<typeof vi.fn<(x: number, y: number) => void>>;
  setTexture: ReturnType<typeof vi.fn<(name: string) => void>>;
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

interface FakeFactory extends OverworldDrawFactory {
  sprites: FakeSprite[];
  rects: FakeRect[];
}

/** Minimal fake `OverworldDrawFactory`, mirroring `sceneView.test.ts`'s `fakeFactory()`. */
function fakeFactory(): FakeFactory {
  const sprites: FakeSprite[] = [];
  const rects: FakeRect[] = [];
  return {
    sprites,
    rects,
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
  };
}

const SIZE = { width: 400, height: 300 };
const TILE_PX = 20;

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
    // Every viewport tile sprite is scaled up from its native 8px atlas
    // frame to fill the tile cell (ROG-63); otherwise it renders at 8px and
    // leaves the rest of the cell empty.
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

    // rects: [minimap border, ...minimap cells, meter background, meter fill]
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
});
