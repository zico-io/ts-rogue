import { describe, expect, it, vi } from "vitest";
import { newGame } from "../engine/state/store";
import type { Scene } from "../engine/state/types";
import {
  describeState,
  SCENE_ORDER,
  SceneSwitcher,
  type SceneView,
} from "./scenes";

function mockView(): SceneView {
  return { setVisible: vi.fn(), setLabel: vi.fn() };
}

describe("describeState", () => {
  it("includes the current scene, gold, party size, and log length", () => {
    const state = newGame(1);
    expect(describeState(state)).toBe(
      `village\ngold ${state.gold} · party ${state.party.length} · log ${state.log.length}`,
    );
  });
});

describe("SceneSwitcher", () => {
  it("shows only the current scene and labels every view", () => {
    const views = Object.fromEntries(
      SCENE_ORDER.map((scene) => [scene, mockView()]),
    ) as Record<Scene, SceneView>;
    const switcher = new SceneSwitcher(views);

    switcher.render(newGame(1));

    for (const scene of SCENE_ORDER) {
      const expectedVisible = scene === "village";
      expect(views[scene].setVisible).toHaveBeenCalledWith(expectedVisible);
      expect(views[scene].setLabel).toHaveBeenCalledTimes(1);
    }
  });
});
