import { describe, expect, it } from "vitest";
import { reduceOverworldUi, resolveOverworldIntent } from "./interaction";

describe("resolveOverworldIntent", () => {
  it("maps arrows and hjkl to move intents", () => {
    expect(resolveOverworldIntent("up")).toEqual({
      kind: "move",
      dx: 0,
      dy: -1,
    });
    expect(resolveOverworldIntent("down")).toEqual({
      kind: "move",
      dx: 0,
      dy: 1,
    });
    expect(resolveOverworldIntent("left")).toEqual({
      kind: "move",
      dx: -1,
      dy: 0,
    });
    expect(resolveOverworldIntent("right")).toEqual({
      kind: "move",
      dx: 1,
      dy: 0,
    });
    expect(resolveOverworldIntent("h")).toEqual({
      kind: "move",
      dx: -1,
      dy: 0,
    });
    expect(resolveOverworldIntent("j")).toEqual({
      kind: "move",
      dx: 0,
      dy: 1,
    });
    expect(resolveOverworldIntent("k")).toEqual({
      kind: "move",
      dx: 0,
      dy: -1,
    });
    expect(resolveOverworldIntent("l")).toEqual({
      kind: "move",
      dx: 1,
      dy: 0,
    });
  });

  it("maps escape to cancel", () => {
    expect(resolveOverworldIntent("escape")).toEqual({ kind: "cancel" });
  });

  it("ignores unbound keys", () => {
    expect(resolveOverworldIntent("tab")).toBeUndefined();
    expect(resolveOverworldIntent("char:o")).toBeUndefined();
  });
});

describe("reduceOverworldUi", () => {
  it("emits a move effect and leaves state untouched", () => {
    const result = reduceOverworldUi({}, { kind: "move", dx: 1, dy: 0 });
    expect(result.effect).toEqual({ type: "move", dx: 1, dy: 0 });
    expect(result.state).toEqual({});
  });

  it("emits a leaveToVillage effect on cancel", () => {
    const result = reduceOverworldUi({}, { kind: "cancel" });
    expect(result.effect).toEqual({ type: "leaveToVillage" });
  });

  it("is a no-op for an unrelated intent", () => {
    const result = reduceOverworldUi({}, { kind: "confirm" });
    expect(result.effect).toBeUndefined();
    expect(result.state).toEqual({});
  });
});
