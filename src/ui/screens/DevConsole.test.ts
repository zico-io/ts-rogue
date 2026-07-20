import { describe, expect, it } from "vitest";
import { newGame } from "../../engine/state/store";
import { runDevCommand } from "./DevConsole";

describe("runDevCommand", () => {
  const state = newGame(1);

  it("issues game events and rejects invalid commands", () => {
    expect(runDevCommand("scene overworld", state).event).toEqual({
      type: "ChangeScene",
      scene: "overworld",
    });
    expect(runDevCommand("log hello world", state).event).toEqual({
      type: "Log",
      message: "hello world",
    });
    expect(runDevCommand("scene nowhere", state).event).toBeUndefined();
    expect(runDevCommand("nope", state).output).toEqual([
      "Unknown command: nope. Run help.",
    ]);
  });
});
