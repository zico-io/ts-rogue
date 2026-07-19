import { describe, expect, it } from "vitest";
import { newGame } from "../engine/state/store.js";
import { deserialize, serialize } from "./save.js";

describe("save round-trip", () => {
  it("restores an equivalent state", () => {
    const state = newGame(9001);
    expect(deserialize(serialize(state))).toEqual(state);
  });
});
