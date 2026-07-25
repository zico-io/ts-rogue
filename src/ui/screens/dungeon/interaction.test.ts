import { describe, expect, it } from "vitest";
import { reduceDungeonUi, resolveDungeonIntent } from "./interaction";

describe("resolveDungeonIntent", () => {
  it("maps arrows/hjkl/wasd to step/turn intents", () => {
    expect(resolveDungeonIntent("up", false)).toEqual({ kind: "stepForward" });
    expect(resolveDungeonIntent("k", false)).toEqual({ kind: "stepForward" });
    expect(resolveDungeonIntent("char:w", false)).toEqual({
      kind: "stepForward",
    });

    expect(resolveDungeonIntent("down", false)).toEqual({ kind: "stepBack" });
    expect(resolveDungeonIntent("j", false)).toEqual({ kind: "stepBack" });
    expect(resolveDungeonIntent("char:s", false)).toEqual({
      kind: "stepBack",
    });

    expect(resolveDungeonIntent("left", false)).toEqual({ kind: "turnLeft" });
    expect(resolveDungeonIntent("h", false)).toEqual({ kind: "turnLeft" });
    expect(resolveDungeonIntent("char:a", false)).toEqual({
      kind: "turnLeft",
    });

    expect(resolveDungeonIntent("right", false)).toEqual({
      kind: "turnRight",
    });
    expect(resolveDungeonIntent("l", false)).toEqual({ kind: "turnRight" });
    expect(resolveDungeonIntent("char:d", false)).toEqual({
      kind: "turnRight",
    });
  });

  it("maps o/>/Enter/< to openChest/descend/exitDungeon", () => {
    expect(resolveDungeonIntent("char:o", false)).toEqual({
      kind: "openChest",
    });
    expect(resolveDungeonIntent("char:>", false)).toEqual({
      kind: "descend",
    });
    expect(resolveDungeonIntent("enter", false)).toEqual({ kind: "descend" });
    expect(resolveDungeonIntent("char:<", false)).toEqual({
      kind: "exitDungeon",
    });
  });

  it("ignores unbound keys", () => {
    expect(resolveDungeonIntent("escape", false)).toBeUndefined();
    expect(resolveDungeonIntent("tab", false)).toBeUndefined();
  });

  it("resolves only the confirm keymap while the evac confirm prompt is open", () => {
    expect(resolveDungeonIntent("enter", true)).toEqual({ kind: "confirm" });
    expect(resolveDungeonIntent("char:y", true)).toEqual({ kind: "confirm" });
    expect(resolveDungeonIntent("escape", true)).toEqual({ kind: "cancel" });
    expect(resolveDungeonIntent("char:n", true)).toEqual({ kind: "cancel" });
    // Normal dungeon keys don't resolve while the prompt is open.
    expect(resolveDungeonIntent("up", true)).toBeUndefined();
    expect(resolveDungeonIntent("char:<", true)).toBeUndefined();
  });
});

describe("reduceDungeonUi", () => {
  it("maps stepForward/stepBack to a step effect with direction", () => {
    expect(reduceDungeonUi({}, { kind: "stepForward" }).effect).toEqual({
      type: "step",
      direction: "forward",
    });
    expect(reduceDungeonUi({}, { kind: "stepBack" }).effect).toEqual({
      type: "step",
      direction: "back",
    });
  });

  it("maps turnLeft/turnRight to a turn effect with direction", () => {
    expect(reduceDungeonUi({}, { kind: "turnLeft" }).effect).toEqual({
      type: "turn",
      direction: "left",
    });
    expect(reduceDungeonUi({}, { kind: "turnRight" }).effect).toEqual({
      type: "turn",
      direction: "right",
    });
  });

  it("maps openChest/descend to their effects", () => {
    expect(reduceDungeonUi({}, { kind: "openChest" }).effect).toEqual({
      type: "openChest",
    });
    expect(reduceDungeonUi({}, { kind: "descend" }).effect).toEqual({
      type: "descend",
    });
  });

  it("is a no-op for an unrelated intent", () => {
    const result = reduceDungeonUi({}, { kind: "confirm" });
    expect(result.effect).toBeUndefined();
    expect(result.state).toEqual({});
  });

  it("exitDungeon opens the confirm prompt without an effect", () => {
    const result = reduceDungeonUi({}, { kind: "exitDungeon" });
    expect(result.effect).toBeUndefined();
    expect(result.state).toEqual({ confirmingExit: true });
  });

  it("confirming the prompt emits the exit effect and resets state", () => {
    const opened = reduceDungeonUi({}, { kind: "exitDungeon" });
    const confirmed = reduceDungeonUi(opened.state, { kind: "confirm" });
    expect(confirmed.effect).toEqual({ type: "exit" });
    expect(confirmed.state).toEqual({});
  });

  it("cancelling the prompt emits no effect and resets state", () => {
    const opened = reduceDungeonUi({}, { kind: "exitDungeon" });
    const cancelled = reduceDungeonUi(opened.state, { kind: "cancel" });
    expect(cancelled.effect).toBeUndefined();
    expect(cancelled.state).toEqual({});
  });

  it("ignores unrelated intents while the confirm prompt is open", () => {
    const opened = reduceDungeonUi({}, { kind: "exitDungeon" });
    const result = reduceDungeonUi(opened.state, { kind: "stepForward" });
    expect(result.effect).toBeUndefined();
    expect(result.state).toEqual({ confirmingExit: true });
  });
});
