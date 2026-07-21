import type { GameState, Scene } from "../engine/state/types";

/** Fixed scene order; also the set of containers `main.ts` must build. */
export const SCENE_ORDER: readonly Scene[] = [
  "village",
  "overworld",
  "dungeon",
  "battle",
] as const;

/**
 * Minimal surface a scene's Pixi container must expose so this module can
 * drive visibility and placeholder text without importing Pixi itself, which
 * keeps `SceneSwitcher` unit-testable without a DOM/WebGL context.
 */
export interface SceneView {
  setVisible(visible: boolean): void;
  setLabel(text: string): void;
}

export type SceneViews = Readonly<Record<Scene, SceneView>>;

/** Cheap, visibly-changing summary of `state` for a scene's placeholder label. */
export function describeState(state: GameState): string {
  return `${state.scene}\ngold ${state.gold} · party ${state.party.length} · log ${state.log.length}`;
}

/** Shows exactly the current scene's view and refreshes every view's label. */
export class SceneSwitcher {
  constructor(private readonly views: SceneViews) {}

  render(state: GameState): void {
    const label = describeState(state);
    for (const scene of SCENE_ORDER) {
      const view = this.views[scene];
      view.setVisible(scene === state.scene);
      view.setLabel(label);
    }
  }
}
