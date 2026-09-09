import { describe, expect, it, vi } from "vitest";
import type { BattleEnemy, BattleState } from "../../engine/combat/types";
import { entry } from "../../engine/log";
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
import type { ParticleHandle } from "./particles";

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

interface FakeParticle extends ParticleHandle {
  setPosition: ReturnType<typeof vi.fn<(x: number, y: number) => void>>;
  setSize: ReturnType<typeof vi.fn<(size: number) => void>>;
  setColor: ReturnType<typeof vi.fn<(color: number) => void>>;
  setAlpha: ReturnType<typeof vi.fn<(alpha: number) => void>>;
  destroy: ReturnType<typeof vi.fn<() => void>>;
}

interface FakeFactory extends BattleDrawFactory {
  sprites: FakeSprite[];
  rects: FakeRect[];
  texts: FakeText[];
  particles: FakeParticle[];
  textureNames: Set<string>;
}

function fakeFactory(textureNames: readonly string[] = []): FakeFactory {
  const sprites: FakeSprite[] = [];
  const rects: FakeRect[] = [];
  const texts: FakeText[] = [];
  const particles: FakeParticle[] = [];
  return {
    sprites,
    rects,
    texts,
    particles,
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
    createParticle(): ParticleHandle {
      const handle: FakeParticle = {
        setPosition: vi.fn(),
        setSize: vi.fn(),
        setColor: vi.fn(),
        setAlpha: vi.fn(),
        destroy: vi.fn(),
      };
      particles.push(handle);
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

function stateInBattle(enemies: BattleEnemy[], classId?: string): GameState {
  const base = newGame(1, classId ? { classId } : undefined);
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

  it("highlights every enemy in the target row for a row-shaped skill (TER-3)", () => {
    const factory = fakeFactory(["slime", "goblin"]);
    const view = new BattleSceneView(factory);
    const state = stateInBattle(
      [
        makeEnemy({ id: "front-1", sprite: "slime", row: "front" }),
        makeEnemy({ id: "front-2", sprite: "goblin", row: "front" }),
        makeEnemy({ id: "back-1", sprite: "slime", row: "back" }),
      ],
      "wizard",
    );

    view.render(state, SIZE, {
      ...INITIAL_BATTLE_UI_STATE,
      mode: "target",
      targetCursor: 0,
      pendingSkill: "hailstorm",
    });

    const litRects = factory.rects.filter((rect) => {
      const pos = rect.setPosition.mock.calls.at(-1);
      return pos !== undefined && (pos[1] as number) > -1000;
    });
    expect(litRects).toHaveLength(2);
  });

  it("shows a hits-everyone indicator and highlights the whole field while browsing a blast skill (TER-3)", () => {
    const factory = fakeFactory(["slime", "goblin"]);
    const view = new BattleSceneView(factory);
    const state = stateInBattle(
      [
        makeEnemy({ id: "front-1", sprite: "slime", row: "front" }),
        makeEnemy({ id: "back-1", sprite: "goblin", row: "back" }),
      ],
      "wizard",
    );

    // wizard's skill list is flame/heal/frost/hailstorm/meteor - meteor is
    // last and allEnemies-shaped.
    view.render(state, SIZE, {
      ...INITIAL_BATTLE_UI_STATE,
      mode: "skill",
      skillCursor: 4,
    });

    const indicatorText = factory.texts.find((text) =>
      text.setText.mock.calls.some((call) => call[0] === "Hits everyone"),
    );
    expect(indicatorText).toBeDefined();

    const litRects = factory.rects.filter((rect) => {
      const pos = rect.setPosition.mock.calls.at(-1);
      return pos !== undefined && (pos[1] as number) > -1000;
    });
    expect(litRects).toHaveLength(2);
  });

  it("draws a back-row label once a back-row enemy exists, parked otherwise", () => {
    const factory = fakeFactory(["slime", "goblin"]);
    const view = new BattleSceneView(factory);
    const withBackRow = stateInBattle([
      makeEnemy({ id: "front-1", sprite: "slime", row: "front" }),
      makeEnemy({ id: "back-1", sprite: "goblin", row: "back" }),
    ]);
    view.render(withBackRow, SIZE, INITIAL_BATTLE_UI_STATE);
    const label = factory.texts.find((text) =>
      text.setText.mock.calls.some((call) => call[0] === "-- back row --"),
    );
    expect(label).toBeDefined();
    const labelPos = label?.setPosition.mock.calls.at(-1);
    expect(labelPos?.[1]).toBeGreaterThan(-1000);

    const frontOnly = stateInBattle([
      makeEnemy({ id: "front-1", sprite: "slime", row: "front" }),
    ]);
    view.render(frontOnly, SIZE, INITIAL_BATTLE_UI_STATE);
    const labelPosAfter = label?.setPosition.mock.calls.at(-1);
    expect(labelPosAfter?.[1]).toBeLessThan(-1000);
  });

  it("marks a living back-row enemy unreachable while the front row lives", () => {
    const factory = fakeFactory(["slime", "goblin"]);
    const view = new BattleSceneView(factory);
    const state = stateInBattle([
      makeEnemy({ id: "front-1", sprite: "slime", row: "front" }),
      makeEnemy({
        id: "back-1",
        name: "Goblin",
        sprite: "goblin",
        row: "back",
      }),
    ]);

    view.render(state, SIZE, INITIAL_BATTLE_UI_STATE);

    const backName = factory.texts.find((text) =>
      text.setText.mock.calls.some((call) =>
        (call[0] as string).includes("(unreachable)"),
      ),
    );
    expect(backName).toBeDefined();
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

  it("spawns a fire-colored burst on an enemy hit tagged with a fire-element log line", () => {
    const factory = fakeFactory(["slime"]);
    const view = new BattleSceneView(factory);
    const enemy = makeEnemy({ hp: 20, maxHp: 20 });
    const primed = stateInBattle([enemy]);
    view.render(primed, SIZE, INITIAL_BATTLE_UI_STATE);

    const damaged = stateInBattle([{ ...enemy, hp: 12 }]);
    damaged.log = [
      ...primed.log,
      entry("Hero casts Flame on Slime for 8 (fire)!", "damage", {
        element: "fire",
      }),
    ];
    view.render(damaged, SIZE, INITIAL_BATTLE_UI_STATE);

    const fireColor = toPixiColor(theme.element.fire);
    const fireParticles = factory.particles.filter((particle) =>
      particle.setColor.mock.calls.some((call) => call[0] === fireColor),
    );
    expect(fireParticles.length).toBeGreaterThan(0);
  });

  it("spawns a physical-colored burst on a plain melee hit with no element tag", () => {
    const factory = fakeFactory(["slime"]);
    const view = new BattleSceneView(factory);
    const enemy = makeEnemy({ hp: 20, maxHp: 20 });
    const primed = stateInBattle([enemy]);
    view.render(primed, SIZE, INITIAL_BATTLE_UI_STATE);

    const damaged = stateInBattle([{ ...enemy, hp: 15 }]);
    damaged.log = [
      ...primed.log,
      entry("Hero hits Slime for 5", "damage", { element: "physical" }),
    ];
    view.render(damaged, SIZE, INITIAL_BATTLE_UI_STATE);

    const physicalColor = toPixiColor(theme.element.physical);
    const sparkParticles = factory.particles.filter((particle) =>
      particle.setColor.mock.calls.some((call) => call[0] === physicalColor),
    );
    expect(sparkParticles.length).toBeGreaterThan(0);
  });

  it("spawns heal-colored sparkles when the active member's HP rises between renders", () => {
    const factory = fakeFactory(["slime"]);
    const view = new BattleSceneView(factory);
    const state = stateInBattle([makeEnemy()]);
    state.party[0].hp = 5;
    view.render(state, SIZE, INITIAL_BATTLE_UI_STATE);

    const healed = { ...state, party: [{ ...state.party[0], hp: 15 }] };
    view.render(healed, SIZE, INITIAL_BATTLE_UI_STATE);

    const healColor = toPixiColor(theme.heal);
    const healParticles = factory.particles.filter((particle) =>
      particle.setColor.mock.calls.some((call) => call[0] === healColor),
    );
    expect(healParticles.length).toBeGreaterThan(0);
  });

  it("ages and removes burst particles via tick", () => {
    const factory = fakeFactory(["slime"]);
    const view = new BattleSceneView(factory);
    const enemy = makeEnemy({ hp: 20, maxHp: 20 });
    const primed = stateInBattle([enemy]);
    view.render(primed, SIZE, INITIAL_BATTLE_UI_STATE);

    const damaged = stateInBattle([{ ...enemy, hp: 10 }]);
    damaged.log = [
      ...primed.log,
      entry("Hero hits Slime for 10", "damage", { element: "physical" }),
    ];
    view.render(damaged, SIZE, INITIAL_BATTLE_UI_STATE);

    const spawned = factory.particles.filter(
      (particle) => !particle.destroy.mock.calls.length,
    );
    expect(spawned.length).toBeGreaterThan(0);

    view.tick(5000);
    for (const particle of spawned) {
      expect(particle.destroy).toHaveBeenCalled();
    }
  });

  it("suppresses new burst/sparkle particles once reduced motion is enabled, but keeps damage numerals", () => {
    const factory = fakeFactory(["slime"]);
    const view = new BattleSceneView(factory);
    view.setReducedMotion(true);
    const enemy = makeEnemy({ hp: 20, maxHp: 20 });
    const primed = stateInBattle([enemy]);
    view.render(primed, SIZE, INITIAL_BATTLE_UI_STATE);

    const damaged = stateInBattle([{ ...enemy, hp: 10 }]);
    damaged.log = [
      ...primed.log,
      entry("Hero hits Slime for 10", "damage", { element: "fire" }),
    ];
    view.render(damaged, SIZE, INITIAL_BATTLE_UI_STATE);

    expect(factory.particles.length).toBe(0);
    const floater = factory.texts.find((text) =>
      text.setText.mock.calls.some((call) => call[0] === "-10"),
    );
    expect(floater).toBeDefined();
  });
});
