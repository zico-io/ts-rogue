import { describe, expect, it, vi } from "vitest";
import { newGame } from "../../engine/state/store";
import { entry } from "../../engine/state/types";
import type { DrawFactory, RectHandle, TextHandle } from "./sceneView";
import { SceneChromeView, UNIT_PX } from "./sceneView";

interface FakeRect extends RectHandle {
  setSize: ReturnType<typeof vi.fn<(width: number, height: number) => void>>;
  setColor: ReturnType<typeof vi.fn<(color: number) => void>>;
  setPosition: ReturnType<typeof vi.fn<(x: number, y: number) => void>>;
  destroy: ReturnType<typeof vi.fn<() => void>>;
}

interface FakeText extends TextHandle {
  setText: ReturnType<typeof vi.fn<(text: string) => void>>;
  destroy: ReturnType<typeof vi.fn<() => void>>;
}

interface FakeFactory extends DrawFactory {
  rects: FakeRect[];
  texts: FakeText[];
  createRectCalls: number;
  createTextCalls: number;
}

/** Minimal fake `DrawFactory`, mirroring how `scenes.test.ts` fakes `SceneView` without real Pixi. */
function fakeFactory(): FakeFactory {
  const rects: FakeRect[] = [];
  const texts: FakeText[] = [];
  const factory: FakeFactory = {
    rects,
    texts,
    createRectCalls: 0,
    createTextCalls: 0,
    createRect(): RectHandle {
      factory.createRectCalls += 1;
      const handle: FakeRect = {
        setPosition: vi.fn(),
        setSize: vi.fn(),
        setColor: vi.fn(),
        destroy: vi.fn(),
      };
      rects.push(handle);
      return handle;
    },
    createText(initialText: string): TextHandle {
      factory.createTextCalls += 1;
      let text = initialText;
      const handle: FakeText = {
        setPosition: vi.fn(),
        setText: vi.fn((value: string) => {
          text = value;
        }),
        setColor: vi.fn(),
        destroy: vi.fn(),
        get width() {
          return text.length * 8;
        },
        get height() {
          return 14;
        },
      };
      texts.push(handle);
      return handle;
    },
  };
  return factory;
}

const SIZE = { width: 800, height: 400 };

describe("SceneChromeView", () => {
  it("returns a content rect sized from buildChrome, scaled by UNIT_PX", () => {
    const factory = fakeFactory();
    const view = new SceneChromeView(factory);
    const state = newGame(1);
    const rect = view.render(
      state,
      { width: 80 * UNIT_PX, height: 24 * UNIT_PX },
      { title: "Village" },
    );
    expect(rect.width).toBe(76 * UNIT_PX);
    expect(rect.x).toBe(UNIT_PX);
    expect(rect.y).toBe(UNIT_PX);
  });

  it("creates the border rect and title text once, reusing them across renders", () => {
    const factory = fakeFactory();
    const view = new SceneChromeView(factory);
    const state = newGame(1);
    view.render(state, SIZE, { title: "Village" });
    const rectsAfterFirst = factory.createRectCalls;
    const textsAfterFirst = factory.createTextCalls;
    view.render(state, SIZE, { title: "Village" });
    expect(factory.createRectCalls).toBe(rectsAfterFirst);
    expect(factory.createTextCalls).toBe(textsAfterFirst);
  });

  it("reuses a party member's keyed text/meter handles across renders instead of recreating them", () => {
    const factory = fakeFactory();
    const view = new SceneChromeView(factory);
    const state = newGame(1);
    view.render(state, SIZE, { title: "Village" });
    const rectsAfterFirst = factory.createRectCalls;
    const textsAfterFirst = factory.createTextCalls;

    const damaged = {
      ...state,
      party: [{ ...state.party[0], hp: state.party[0].hp - 1 }],
    };
    view.render(damaged, SIZE, { title: "Village" });
    expect(factory.createRectCalls).toBe(rectsAfterFirst);
    expect(factory.createTextCalls).toBe(textsAfterFirst);
    // the reused HP-value text handle was updated, not thrown away
    const hpValueText = factory.texts.find((t) =>
      t.setText.mock.calls.some(
        (call) =>
          call[0] === ` ${damaged.party[0].hp}/${damaged.party[0].maxHp}`,
      ),
    );
    expect(hpValueText).toBeDefined();
  });

  it("creates two rect handles (background + fill) per meter, plus the border and panel-background rects", () => {
    const factory = fakeFactory();
    const view = new SceneChromeView(factory);
    const state = newGame(1);
    view.render(state, SIZE, { title: "Village" });
    // border rect + panel background rect + (background, fill) per member for HP and MP
    // = 2 + party.length * 4
    expect(factory.rects.length).toBe(2 + state.party.length * 4);
  });

  it("sizes a meter's fill rect proportionally to value/max", () => {
    const factory = fakeFactory();
    const view = new SceneChromeView(factory);
    const state = newGame(1);
    const halfHp = {
      ...state,
      party: [{ ...state.party[0], hp: state.party[0].maxHp / 2 }],
    };
    view.render(halfHp, SIZE, { title: "Village" });
    // rects order: [border, panel-background, hp-bg, hp-fill, mp-bg, mp-fill]
    const hpBgWidth = factory.rects[2].setSize.mock.calls.at(-1)?.[0] as number;
    const hpFillWidth = factory.rects[3].setSize.mock.calls.at(
      -1,
    )?.[0] as number;
    expect(hpFillWidth).toBeCloseTo(hpBgWidth * 0.5, 0);
  });

  it("keys log lines by absolute message position and destroys handles that scroll out of view", () => {
    const factory = fakeFactory();
    const view = new SceneChromeView(factory);
    const state = newGame(1);
    // small canvas -> few maxLines, so a couple more messages push old ones out
    const small = { width: 40 * UNIT_PX, height: 10 * UNIT_PX };
    const withLogs = {
      ...state,
      log: Array.from({ length: 3 }, (_, i) => entry(`line ${i}`, "system")),
    };
    view.render(withLogs, small, { title: "Village" });
    const textCountAfterFirst = factory.texts.length;

    const grown = {
      ...state,
      log: [
        ...withLogs.log,
        entry("line 3", "system"),
        entry("line 4", "system"),
        entry("line 5", "system"),
        entry("line 6", "damage"),
      ],
    };
    view.render(grown, small, { title: "Village" });
    const destroyedCount = factory.texts.filter(
      (t) => t.destroy.mock.calls.length > 0,
    ).length;
    expect(destroyedCount).toBeGreaterThan(0);
    expect(factory.texts.length).toBeGreaterThanOrEqual(textCountAfterFirst);
  });

  it("omits meter rects entirely when the party is empty", () => {
    const factory = fakeFactory();
    const view = new SceneChromeView(factory);
    const state = { ...newGame(1), party: [] };
    view.render(state, SIZE, { title: "Village" });
    expect(factory.rects.length).toBe(2); // border + panel background only
  });
});
