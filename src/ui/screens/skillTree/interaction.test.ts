import { describe, expect, it } from "vitest";
import type { SkillNodeDef } from "../../../data/skillTrees";
import type { SkillNodeState } from "../../../engine/entities/skillTree";
import {
  INITIAL_SKILL_TREE_UI_STATE,
  reduceSkillTreeUi,
  resolveSkillTreeIntent,
} from "./interaction";

const NODES: readonly SkillNodeDef[] = [
  {
    id: "root",
    name: "Root",
    cost: 1,
    prereqs: [],
    type: "stat",
    stat: "str",
    amount: 1,
  },
  {
    id: "branch",
    name: "Branch",
    cost: 2,
    prereqs: ["root"],
    type: "skill",
    skillId: "cleave",
  },
];

function ctx(
  nodeStates: readonly SkillNodeState[],
  partyLength = 1,
): { partyLength: number; nodes: typeof NODES; nodeStates: typeof nodeStates } {
  return { partyLength, nodes: NODES, nodeStates };
}

describe("resolveSkillTreeIntent", () => {
  it("maps navigation keys and ignores unbound keys", () => {
    expect(resolveSkillTreeIntent("up")).toEqual({ kind: "menuUp" });
    expect(resolveSkillTreeIntent("down")).toEqual({ kind: "menuDown" });
    expect(resolveSkillTreeIntent("enter")).toEqual({ kind: "confirm" });
    expect(resolveSkillTreeIntent("escape")).toEqual({ kind: "cancel" });
    expect(resolveSkillTreeIntent("tab")).toBeUndefined();
  });
});

describe("reduceSkillTreeUi", () => {
  it("cancel signals back and leaves state untouched", () => {
    const result = reduceSkillTreeUi(
      INITIAL_SKILL_TREE_UI_STATE,
      { kind: "cancel" },
      ctx(["unlockable", "locked"]),
    );
    expect(result.effect).toEqual({ type: "back" });
    expect(result.state).toEqual(INITIAL_SKILL_TREE_UI_STATE);
  });

  it("wraps the cursor up and down across the node list", () => {
    const state = { memberIndex: 0, cursor: 0 };
    expect(
      reduceSkillTreeUi(
        state,
        { kind: "menuUp" },
        ctx(["unlockable", "locked"]),
      ).state.cursor,
    ).toBe(1);
    expect(
      reduceSkillTreeUi(
        state,
        { kind: "menuDown" },
        ctx(["unlockable", "locked"]),
      ).state.cursor,
    ).toBe(1);
  });

  it("confirming an unlockable node emits an unlock effect for that node id", () => {
    const state = { memberIndex: 0, cursor: 0 };
    const result = reduceSkillTreeUi(
      state,
      { kind: "confirm" },
      ctx(["unlockable", "locked"]),
    );
    expect(result.effect).toEqual({ type: "unlock", nodeId: "root" });
  });

  it("confirming a locked node is a no-op: invalid unlocks stay unreachable", () => {
    const state = { memberIndex: 0, cursor: 1 };
    const result = reduceSkillTreeUi(
      state,
      { kind: "confirm" },
      ctx(["unlocked", "locked"]),
    );
    expect(result.effect).toBeUndefined();
  });

  it("confirming an already-unlocked node is also a no-op", () => {
    const state = { memberIndex: 0, cursor: 0 };
    const result = reduceSkillTreeUi(
      state,
      { kind: "confirm" },
      ctx(["unlocked", "locked"]),
    );
    expect(result.effect).toBeUndefined();
  });

  it("switches member with menuLeft/menuRight and resets the cursor", () => {
    const state = { memberIndex: 0, cursor: 1 };
    const result = reduceSkillTreeUi(
      state,
      { kind: "menuRight" },
      ctx(["unlockable", "locked"], 3),
    );
    expect(result.state).toEqual({ memberIndex: 1, cursor: 0 });
  });

  it("ignores menuLeft/menuRight for a solo party", () => {
    const state = { memberIndex: 0, cursor: 1 };
    const result = reduceSkillTreeUi(
      state,
      { kind: "menuRight" },
      ctx(["unlockable", "locked"], 1),
    );
    expect(result.state).toEqual(state);
  });

  it("is a no-op for an unrelated intent", () => {
    const state = { memberIndex: 0, cursor: 0 };
    const result = reduceSkillTreeUi(
      state,
      { kind: "toggleConsole" },
      ctx(["unlockable", "locked"]),
    );
    expect(result.state).toEqual(state);
    expect(result.effect).toBeUndefined();
  });
});
