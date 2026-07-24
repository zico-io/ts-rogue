import { describe, expect, it } from "vitest";
import { reduceDungeonUi, resolveDungeonIntent } from "./interaction";

describe("resolveDungeonIntent", () => {
  it("maps arrows/hjkl/wasd to step/turn intents", () => {
    expect(resolveDungeonIntent("up")).toEqual({ kind: "stepForward" });
    expect(resolveDungeonIntent("k")).toEqual({ kind: "stepForward" });
    expect(resolveDungeonIntent("char:w")).toEqual({ kind: "stepForward" });

    expect(resolveDungeonIntent("down")).toEqual({ kind: "stepBack" });
    expect(resolveDungeonIntent("j")).toEqual({ kind: "stepBack" });
    expect(resolveDungeonIntent("char:s")).toEqual({ kind: "stepBack" });

    expect(resolveDungeonIntent("left")).toEqual({ kind: "turnLeft" });
    expect(resolveDungeonIntent("h")).toEqual({ kind: "turnLeft" });
    expect(resolveDungeonIntent("char:a")).toEqual({ kind: "turnLeft" });

    expect(resolveDungeonIntent("right")).toEqual({ kind: "turnRight" });
    expect(resolveDungeonIntent("l")).toEqual({ kind: "turnRight" });
    expect(resolveDungeonIntent("char:d")).toEqual({ kind: "turnRight" });
  });

  it("maps o/>/Enter/< to openChest/descend/exit", () => {
    expect(resolveDungeonIntent("char:o")).toEqual({ kind: "openChest" });
    expect(resolveDungeonIntent("char:>")).toEqual({ kind: "descend" });
    expect(resolveDungeonIntent("enter")).toEqual({ kind: "descend" });
    expect(resolveDungeonIntent("char:<")).toEqual({ kind: "exitDungeon" });
  });

  it("ignores unbound keys", () => {
    expect(resolveDungeonIntent("escape")).toBeUndefined();
    expect(resolveDungeonIntent("tab")).toBeUndefined();
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

  it("maps openChest/descend/exitDungeon to their effects", () => {
    expect(reduceDungeonUi({}, { kind: "openChest" }).effect).toEqual({
      type: "openChest",
    });
    expect(reduceDungeonUi({}, { kind: "descend" }).effect).toEqual({
      type: "descend",
    });
    expect(reduceDungeonUi({}, { kind: "exitDungeon" }).effect).toEqual({
      type: "exit",
    });
  });

  it("is a no-op for an unrelated intent", () => {
    const result = reduceDungeonUi({}, { kind: "confirm" });
    expect(result.effect).toBeUndefined();
    expect(result.state).toEqual({});
  });
});
