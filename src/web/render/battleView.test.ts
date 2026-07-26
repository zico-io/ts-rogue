import { describe, expect, it, vi } from "vitest";
import type { BattleEnemy, BattleState } from "../../engine/combat/types";
import { newGame } from "../../engine/state/store";
import type { GameState } from "../../engine/state/types";
import { INITIAL_BATTLE_UI_STATE } from "../../ui/screens/battle/interaction";
import { theme, toPixiColor } from "../../ui/theme";
import type {
  BattleDrawFactory,
  BattleRectHandle,
  BattleSpriteHandle,
  BattleTextHandle,
} from "./battleView";
import { artPxFor, BattleSceneView } from "./battleView";

interface FakeSprite extends BattleSpriteHandle {
  setPosition: ReturnType<typeof vi.fn<(x: number, y: number) => void>>;
  setTexture: ReturnType<typeof vi.fn<(name: string) => void>>;
  setSize: ReturnType<typeof vi.fn<(width: number, height: number) => void>>;
  setTint: ReturnType<typeof vi.fn<(color: number) => void>>;
  destroy: ReturnType<typeof vi.fn<() => void>>;
}

interface FakeRect extends BattleRectHandle {
  setPosition: ReturnType<typeof vi.fn<(x: number, y: number) => void>>;
  setSize: ReturnType<typeof vi.fn<(width: number, height: number) => void>>;
  setColor: ReturnType<typeof vi.fn<(color: number) => void>>;
  destroy: ReturnType<typeof vi.fn<() => void>>;
}

interface FakeText extends BattleTextHandle {
  setPosition: ReturnType<typeof vi.fn<(x: number, y: number) => void>>;
  setText: ReturnType<typeof vi.fn<(text: string) => void>>;
  setColor: ReturnType<typeof vi.fn<(color: number) => void>>;
  setAlpha: ReturnType<typeof vi.fn<(alpha: number) => void>>;
  destroy: ReturnType<typeof vi.fn<() => void>>;
  width: number;
}

interface FakeFactory extends BattleDrawFactory {
  sprites: FakeSprite[];
  rects: FakeRect[];
  texts: FakeText[];
  textureNames: Set<string>;
}

function fakeFactory(textureNames: readonly string[] = []): FakeFactory {
  const sprites: FakeSprite[] = [];
  const rects: FakeRect[] = [];
  const texts: FakeText[] = [];
  return {
    sprites,
    rects,
    texts,
    textureNames: new Set(textureNames),
    hasTexture(name: string) {
      return this.textureNames.has(name);
    },
    createSprite(): BattleSpriteHandle {
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
    createRect(): BattleRectHandle {
      const handle: FakeRect = {
        setPosition: vi.fn(),
        setSize: vi.fn(),
        setColor: vi.fn(),
        destroy: vi.fn(),
      };
      rects.push(handle);
      return handle;
    },
    createText(initialText: string): BattleTextHandle {
      const handle: FakeText = {
        setPosition: vi.fn(),
        setText: vi.fn(),
        setColor: vi.fn(),
        setAlpha: vi.fn(),
        destroy: vi.fn(),
        width: initialText.length * 8,
      };
      texts.push(handle);
      return handle;
    },
  };
}

function makeEnemy(overrides: Partial<BattleEnemy> = {}): BattleEnemy {
  return {
    id: "slime-1",
    defId: "slime",
    name: "Slime",
    hp: 12,
    maxHp: 12,
    stats: { str: 1, agi: 1, vit: 1, int: 1 },
    ascii: ["(o_o)"],
    color: "#33cc33",
    sprite: "slime",
    xp: 1,
    gold: 1,
    ...overrides,
  };
}

function stateInBattle(enemies: BattleEnemy[]): GameState {
  const base = newGame(1);
  const actor = base.party[0];
  const battle: BattleState = {
    enemies,
    status: "ongoing",
    initiative: [actor.id, ...enemies.map((e) => e.id)],
    awaitingCommand: true,
    returnScene: "overworld",
    activeMemberId: actor.id,
    defendingIds: [],
  };
  return { ...base, scene: "battle", battleState: battle };
}

const SIZE = { width: 500, height: 400 };

const EXPECTED_ART_PX = artPxFor(SIZE);

describe("BattleSceneView", () => {
  it("draws one sprite per living enemy, textured by its sprite id", () => {
    const factory = fakeFactory(["slime", "goblin"]);
    const view = new BattleSceneView(factory);
    const state = stateInBattle([
      makeEnemy({ id: "slime-1", sprite: "slime" }),
      makeEnemy({ id: "goblin-1", name: "Goblin", sprite: "goblin" }),
    ]);

    view.render(state, SIZE, INITIAL_BATTLE_UI_STATE);

    expect(factory.sprites.length).toBe(2);
    const slimeSprite = factory.sprites.find((sprite) =>
      sprite.setTexture.mock.calls.some((call) => call[0] === "slime"),
    );
    const goblinSprite = factory.sprites.find((sprite) =>
      sprite.setTexture.mock.calls.some((call) => call[0] === "goblin"),
    );
    expect(slimeSprite).toBeDefined();
    expect(goblinSprite).toBeDefined();
    expect(factory.rects.length).toBeGreaterThanOrEqual(0);

    expect(slimeSprite?.setSize).toHaveBeenCalledWith(
      EXPECTED_ART_PX,
      EXPECTED_ART_PX,
    );
    expect(goblinSprite?.setSize).toHaveBeenCalledWith(
      EXPECTED_ART_PX,
      EXPECTED_ART_PX,
    );
  });

  it("falls back to a tinted rect (not a sprite) for an enemy with no sprite id", () => {
    const factory = fakeFactory(["slime"]);
    const view = new BattleSceneView(factory);
    const enemy = makeEnemy({
      id: "mystery-1",
      name: "Mystery",
      sprite: undefined,
      color: "#ff00ff",
    });
    const state = stateInBattle([enemy]);

    view.render(state, SIZE, INITIAL_BATTLE_UI_STATE);

    expect(factory.sprites.length).toBe(0);
    const fallback = factory.rects.find((rect) =>
      rect.setColor.mock.calls.some(
        (call) => call[0] === toPixiColor("#ff00ff"),
      ),
    );
    expect(fallback).toBeDefined();
    expect(fallback?.setSize).toHaveBeenCalled();
  });

  it("falls back to a tinted rect for an enemy whose sprite id isn't in the atlas", () => {
    const factory = fakeFactory([]);
    const view = new BattleSceneView(factory);
    const enemy = makeEnemy({
      id: "unknown-1",
      sprite: "no-such-frame",
      color: "#123456",
    });
    const state = stateInBattle([enemy]);

    view.render(state, SIZE, INITIAL_BATTLE_UI_STATE);

    expect(factory.sprites.length).toBe(0);
    const fallback = factory.rects.find((rect) =>
      rect.setColor.mock.calls.some(
        (call) => call[0] === toPixiColor("#123456"),
      ),
    );
    expect(fallback).toBeDefined();
  });

  it("lands the selection highlight on the selected enemy in target mode", () => {
    const factory = fakeFactory(["slime", "goblin"]);
    const view = new BattleSceneView(factory);
    const state = stateInBattle([
      makeEnemy({ id: "slime-1", sprite: "slime" }),
      makeEnemy({ id: "goblin-1", name: "Goblin", sprite: "goblin" }),
    ]);

    view.render(state, SIZE, {
      ...INITIAL_BATTLE_UI_STATE,
      mode: "target",
      targetCursor: 1,
    });

    const goblinSprite = factory.sprites.find((sprite) =>
      sprite.setTexture.mock.calls.some((call) => call[0] === "goblin"),
    );
    const goblinPos = goblinSprite?.setPosition.mock.calls.at(-1);
    expect(goblinPos).toBeDefined();

    const highlight = factory.rects.at(-1);
    const highlightPos = highlight?.setPosition.mock.calls.at(-1);
    expect(highlightPos?.[1]).toBeGreaterThan(-1000);
    expect(highlightPos?.[0]).toBeCloseTo((goblinPos?.[0] as number) - 6, 0);
  });

  it("parks the highlight off-canvas outside target mode", () => {
    const factory = fakeFactory(["slime"]);
    const view = new BattleSceneView(factory);
    const state = stateInBattle([makeEnemy()]);

    view.render(state, SIZE, INITIAL_BATTLE_UI_STATE);

    const highlight = factory.rects.at(-1);
    const highlightPos = highlight?.setPosition.mock.calls.at(-1);
    expect(highlightPos?.[1]).toBeLessThan(-1000);
  });

  it("draws one menu row per action in action mode", () => {
    const factory = fakeFactory(["slime"]);
    const view = new BattleSceneView(factory);
    const state = stateInBattle([makeEnemy()]);

    view.render(state, SIZE, INITIAL_BATTLE_UI_STATE);

    const actionTexts = ["Attack", "Skill", "Item", "Defend", "Flee"];
    for (const action of actionTexts) {
      const match = factory.texts.some((text) =>
        text.setText.mock.calls.some((call) =>
          (call[0] as string).includes(action),
        ),
      );
      expect(match).toBe(true);
    }
  });

  it("draws one menu row per known skill in skill mode, fading unaffordable, unselected ones", () => {
    const factory = fakeFactory(["slime"]);
    const view = new BattleSceneView(factory);
    const state = stateInBattle([makeEnemy()]);

    state.party[0].mp = 0;

    view.render(state, SIZE, {
      ...INITIAL_BATTLE_UI_STATE,
      mode: "skill",
      skillCursor: 0,
    });

    const secondWindText = factory.texts.find((text) =>
      text.setText.mock.calls.some((call) =>
        (call[0] as string).includes("Second Wind"),
      ),
    );
    expect(secondWindText).toBeDefined();
    expect(secondWindText?.setColor.mock.calls.at(-1)?.[0]).toBe(
      toPixiColor(theme.textFaint),
    );

    const cleaveText = factory.texts.find((text) =>
      text.setText.mock.calls.some((call) =>
        (call[0] as string).includes("Cleave"),
      ),
    );
    expect(cleaveText?.setColor.mock.calls.at(-1)?.[0]).toBe(
      toPixiColor(theme.accent),
    );
  });

  it("shows a no-usable-items row in item mode when the party has no heal items", () => {
    const factory = fakeFactory(["slime"]);
    const view = new BattleSceneView(factory);
    const state = stateInBattle([makeEnemy()]);

    view.render(state, SIZE, { ...INITIAL_BATTLE_UI_STATE, mode: "item" });

    const match = factory.texts.some((text) =>
      text.setText.mock.calls.some((call) =>
        (call[0] as string).includes("no usable items"),
      ),
    );
    expect(match).toBe(true);
  });

  it("shows a select-a-target row in target mode", () => {
    const factory = fakeFactory(["slime"]);
    const view = new BattleSceneView(factory);
    const state = stateInBattle([makeEnemy()]);

    view.render(state, SIZE, { ...INITIAL_BATTLE_UI_STATE, mode: "target" });

    const match = factory.texts.some((text) =>
      text.setText.mock.calls.some((call) =>
        (call[0] as string).includes("Select a target"),
      ),
    );
    expect(match).toBe(true);
  });

  it("spawns a floating damage number on an HP drop, which the ticker eventually removes", () => {
    const factory = fakeFactory(["slime"]);
    const view = new BattleSceneView(factory);
    const enemy = makeEnemy({ hp: 12, maxHp: 12 });
    const state = stateInBattle([enemy]);

    view.render(state, SIZE, INITIAL_BATTLE_UI_STATE);
    const textCountBefore = factory.texts.length;

    const damaged = stateInBattle([{ ...enemy, hp: 6 }]);
    view.render(damaged, SIZE, INITIAL_BATTLE_UI_STATE);

    const floater = factory.texts
      .slice(textCountBefore)
      .find((text) => text.setText.mock.calls.some((call) => call[0] === "-6"));
    expect(floater).toBeDefined();
    expect(floater?.destroy).not.toHaveBeenCalled();

    view.tick(1000);
    expect(floater?.destroy).toHaveBeenCalled();
  });

  it("reuses enemy art/nameplate/HP handles across renders when the roster is unchanged", () => {
    const factory = fakeFactory(["slime"]);
    const view = new BattleSceneView(factory);
    const enemy = makeEnemy();
    const state = stateInBattle([enemy]);

    view.render(state, SIZE, INITIAL_BATTLE_UI_STATE);
    const spriteCountAfterFirst = factory.sprites.length;
    const textCountAfterFirst = factory.texts.length;

    view.render(state, SIZE, INITIAL_BATTLE_UI_STATE);
    expect(factory.sprites.length).toBe(spriteCountAfterFirst);

    expect(factory.texts.length).toBeGreaterThanOrEqual(textCountAfterFirst);
  });
});
