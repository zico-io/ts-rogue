import { describe, expect, it } from "vitest";
import { tierForFloor } from "./lootTables";

describe("tierForFloor", () => {
  it("returns 1 for floor 0 (edge)", () => {
    expect(tierForFloor(0)).toBe(1);
  });

  it("returns 1 for floor 1", () => {
    expect(tierForFloor(1)).toBe(1);
  });

  it("returns 2 for floor 2", () => {
    expect(tierForFloor(2)).toBe(2);
  });

  it("returns 3 for floor 3", () => {
    expect(tierForFloor(3)).toBe(3);
  });

  it("returns 3 for floors beyond 3", () => {
    expect(tierForFloor(4)).toBe(3);
    expect(tierForFloor(10)).toBe(3);
  });
});
