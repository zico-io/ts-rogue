import type { GameState, Scene } from "../engine/state/types";

export const SCENE_ORDER: readonly Scene[] = [
  "village",
  "overworld",
  "dungeon",
  "battle",
] as const;

export interface SceneView {
  setVisible(visible: boolean): void;
  setLabel(text: string): void;
}

export type SceneViews = Readonly<Record<Scene, SceneView>>;

export function describeState(state: GameState): string {
  return `${state.scene}\ngold ${state.gold} · party ${state.party.length} · log ${state.log.length}`;
}

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
