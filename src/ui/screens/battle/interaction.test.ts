import { describe, expect, it } from "vitest";
import type { SkillDef } from "../../../engine/combat/skills";
import {
  type BattleUiContext,
  type BattleUiState,
  INITIAL_BATTLE_UI_STATE,
  reduceBattleUi,
  resolveBattleIntent,
} from "./interaction";

const attackSkill: SkillDef = {
  id: "flame",
  name: "Flame",
  mpCost: 3,
  kind: "attack",
  target: "enemy",
  power: 5,
};

const healSkill: SkillDef = {
  id: "heal",
  name: "Heal",
  mpCost: 2,
  kind: "heal",
  target: "self",
  power: 5,
};

function ctx(overrides: Partial<BattleUiContext> = {}): BattleUiContext {
  return {
    actorId: "hero",
    actorMp: 10,
    knownSkills: [attackSkill, healSkill],
    aliveEnemyIds: ["goblin", "slime"],
    usableItemIds: ["potion", "hi-potion"],
    ...overrides,
  };
}

function actionState(overrides: Partial<BattleUiState> = {}): BattleUiState {
  return { ...INITIAL_BATTLE_UI_STATE, ...overrides };
}

describe("resolveBattleIntent", () => {
  it("maps up/down/enter/escape to menu/confirm/cancel intents", () => {
    expect(resolveBattleIntent("up")).toEqual({ kind: "menuUp" });
    expect(resolveBattleIntent("down")).toEqual({ kind: "menuDown" });
    expect(resolveBattleIntent("enter")).toEqual({ kind: "confirm" });
    expect(resolveBattleIntent("escape")).toEqual({ kind: "cancel" });
  });

  it("ignores unbound keys", () => {
    expect(resolveBattleIntent("tab")).toBeUndefined();
    expect(resolveBattleIntent("char:h")).toBeUndefined();
  });
});

describe("reduceBattleUi - action mode", () => {
  it("Escape is a no-op from the action menu", () => {
    const result = reduceBattleUi(actionState(), { kind: "cancel" }, ctx());
    expect(result.state).toEqual(actionState());
    expect(result.effect).toBeUndefined();
  });

  it("wraps actionCursor up/down over the 5 actions", () => {
    const up = reduceBattleUi(
      actionState({ actionCursor: 0 }),
      { kind: "menuUp" },
      ctx(),
    );
    expect(up.state.actionCursor).toBe(4);

    const down = reduceBattleUi(
      actionState({ actionCursor: 4 }),
      { kind: "menuDown" },
      ctx(),
    );
    expect(down.state.actionCursor).toBe(0);
  });

  it("Attack moves to target mode with targetCursor/pendingSkill reset", () => {
    const result = reduceBattleUi(
      actionState({ actionCursor: 0, targetCursor: 1, pendingSkill: "x" }),
      { kind: "confirm" },
      ctx(),
    );
    expect(result.state.mode).toBe("target");
    expect(result.state.targetCursor).toBe(0);
    expect(result.state.pendingSkill).toBeNull();
    expect(result.effect).toBeUndefined();
  });

  it("Skill moves to skill mode with skillCursor reset", () => {
    const result = reduceBattleUi(
      actionState({ actionCursor: 1, skillCursor: 1 }),
      { kind: "confirm" },
      ctx(),
    );
    expect(result.state.mode).toBe("skill");
    expect(result.state.skillCursor).toBe(0);
  });

  it("Item moves to item mode with itemCursor reset", () => {
    const result = reduceBattleUi(
      actionState({ actionCursor: 2, itemCursor: 1 }),
      { kind: "confirm" },
      ctx(),
    );
    expect(result.state.mode).toBe("item");
    expect(result.state.itemCursor).toBe(0);
  });

  it("Defend dispatches a defend effect and resets state", () => {
    const result = reduceBattleUi(
      actionState({ actionCursor: 3 }),
      { kind: "confirm" },
      ctx(),
    );
    expect(result.effect).toEqual({ type: "defend" });
    expect(result.state).toEqual(INITIAL_BATTLE_UI_STATE);
  });

  it("Flee dispatches a flee effect and resets state", () => {
    const result = reduceBattleUi(
      actionState({ actionCursor: 4 }),
      { kind: "confirm" },
      ctx(),
    );
    expect(result.effect).toEqual({ type: "flee" });
    expect(result.state).toEqual(INITIAL_BATTLE_UI_STATE);
  });
});

describe("reduceBattleUi - skill mode", () => {
  function skillState(overrides: Partial<BattleUiState> = {}): BattleUiState {
    return actionState({ mode: "skill", ...overrides });
  }

  it("Escape returns to action mode and clears pendingSkill", () => {
    const result = reduceBattleUi(
      skillState({ pendingSkill: "flame" }),
      { kind: "cancel" },
      ctx(),
    );
    expect(result.state.mode).toBe("action");
    expect(result.state.pendingSkill).toBeNull();
  });

  it("wraps skillCursor over knownSkills.length", () => {
    const up = reduceBattleUi(
      skillState({ skillCursor: 0 }),
      { kind: "menuUp" },
      ctx(),
    );
    expect(up.state.skillCursor).toBe(1);

    const down = reduceBattleUi(
      skillState({ skillCursor: 1 }),
      { kind: "menuDown" },
      ctx(),
    );
    expect(down.state.skillCursor).toBe(0);
  });

  it("an enemy-targeted skill with enough MP moves to target mode with pendingSkill set", () => {
    const result = reduceBattleUi(
      skillState({ skillCursor: 0 }),
      { kind: "confirm" },
      ctx({ actorMp: 10 }),
    );
    expect(result.state.mode).toBe("target");
    expect(result.state.targetCursor).toBe(0);
    expect(result.state.pendingSkill).toBe("flame");
    expect(result.effect).toBeUndefined();
  });

  it("a self-targeted skill with enough MP dispatches immediately and resets", () => {
    const result = reduceBattleUi(
      skillState({ skillCursor: 1 }),
      { kind: "confirm" },
      ctx({ actorMp: 10 }),
    );
    expect(result.effect).toEqual({
      type: "skill",
      skillId: "heal",
      targetId: "hero",
    });
    expect(result.state).toEqual(INITIAL_BATTLE_UI_STATE);
  });

  it("insufficient MP is a no-op", () => {
    const result = reduceBattleUi(
      skillState({ skillCursor: 0 }),
      { kind: "confirm" },
      ctx({ actorMp: 0 }),
    );
    expect(result.effect).toBeUndefined();
    expect(result.state).toEqual(skillState({ skillCursor: 0 }));
  });
});

describe("reduceBattleUi - item mode", () => {
  function itemState(overrides: Partial<BattleUiState> = {}): BattleUiState {
    return actionState({ mode: "item", ...overrides });
  }

  it("is a no-op when there are no usable items", () => {
    const result = reduceBattleUi(
      itemState(),
      { kind: "menuDown" },
      ctx({ usableItemIds: [] }),
    );
    expect(result.state).toEqual(itemState());
  });

  it("wraps itemCursor over usableItemIds.length", () => {
    const up = reduceBattleUi(
      itemState({ itemCursor: 0 }),
      { kind: "menuUp" },
      ctx(),
    );
    expect(up.state.itemCursor).toBe(1);

    const down = reduceBattleUi(
      itemState({ itemCursor: 1 }),
      { kind: "menuDown" },
      ctx(),
    );
    expect(down.state.itemCursor).toBe(0);
  });

  it("confirm dispatches an item effect on the actor and resets", () => {
    const result = reduceBattleUi(
      itemState({ itemCursor: 1 }),
      { kind: "confirm" },
      ctx(),
    );
    expect(result.effect).toEqual({
      type: "item",
      itemId: "hi-potion",
      targetId: "hero",
    });
    expect(result.state).toEqual(INITIAL_BATTLE_UI_STATE);
  });
});

describe("reduceBattleUi - target mode", () => {
  function targetState(overrides: Partial<BattleUiState> = {}): BattleUiState {
    return actionState({ mode: "target", ...overrides });
  }

  it("falls back to action mode once there are no more alive enemies", () => {
    const result = reduceBattleUi(
      targetState({ targetCursor: 1 }),
      { kind: "menuDown" },
      ctx({ aliveEnemyIds: [] }),
    );
    expect(result.state.mode).toBe("action");

    expect(result.state.targetCursor).toBe(1);
  });

  it("wraps targetCursor over aliveEnemyIds.length", () => {
    const up = reduceBattleUi(
      targetState({ targetCursor: 0 }),
      { kind: "menuUp" },
      ctx(),
    );
    expect(up.state.targetCursor).toBe(1);

    const down = reduceBattleUi(
      targetState({ targetCursor: 1 }),
      { kind: "menuDown" },
      ctx(),
    );
    expect(down.state.targetCursor).toBe(0);
  });

  it("confirm without a pendingSkill dispatches an attack and resets", () => {
    const result = reduceBattleUi(
      targetState({ targetCursor: 1, pendingSkill: null }),
      { kind: "confirm" },
      ctx(),
    );
    expect(result.effect).toEqual({ type: "attack", targetId: "slime" });
    expect(result.state).toEqual(INITIAL_BATTLE_UI_STATE);
  });

  it("confirm with a pendingSkill dispatches the skill at the chosen target and resets", () => {
    const result = reduceBattleUi(
      targetState({ targetCursor: 0, pendingSkill: "flame" }),
      { kind: "confirm" },
      ctx(),
    );
    expect(result.effect).toEqual({
      type: "skill",
      skillId: "flame",
      targetId: "goblin",
    });
    expect(result.state).toEqual(INITIAL_BATTLE_UI_STATE);
  });
});
