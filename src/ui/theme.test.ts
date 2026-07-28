import { describe, expect, it } from "vitest";
import {
  bar,
  DUNGEON_RAMPS,
  dungeonRamp,
  hpColor,
  mpColor,
  theme,
} from "./theme";

describe("hpColor", () => {
  it("shifts by remaining fraction", () => {
    expect(hpColor(30, 30)).toBe(theme.heal);
    expect(hpColor(15, 30)).toBe(theme.warn);
    expect(hpColor(7, 30)).toBe(theme.danger);
    expect(hpColor(0, 0)).toBe(theme.danger);
  });
});

describe("mpColor", () => {
  it("fades when nearly empty", () => {
    expect(mpColor(10, 10)).toBe(theme.mp);
    expect(mpColor(2, 10)).toBe(theme.textFaint);
    expect(mpColor(0, 0)).toBe(theme.textFaint);
  });
});

describe("bar", () => {
  it("fills proportionally at fixed width", () => {
    expect(bar(30, 30, 10)).toBe("██████████");
    expect(bar(15, 30, 10)).toBe("█████░░░░░");
    expect(bar(0, 30, 10)).toBe("░░░░░░░░░░");
    expect(bar(0, 0, 4)).toBe("░░░░");
  });

  it("shows at least one tick while alive", () => {
    expect(bar(1, 100, 6)).toBe("█░░░░░");
  });
});

describe("dungeonRamp", () => {
  it("maps each story theme id to its own accent ramp", () => {
    expect(dungeonRamp("crypt")).toBe(DUNGEON_RAMPS.crypt);
    expect(dungeonRamp("cave")).toBe(DUNGEON_RAMPS.cave);
    expect(dungeonRamp("ruins")).toBe(DUNGEON_RAMPS.ruins);
  });

  it("falls back to the crypt ramp for an unmapped theme", () => {
    expect(dungeonRamp("garbage")).toBe(DUNGEON_RAMPS.crypt);
  });

  it("gives the three story themes visibly distinct ramps", () => {
    const ramps = [
      dungeonRamp("crypt"),
      dungeonRamp("cave"),
      dungeonRamp("ruins"),
    ];
    expect(new Set(ramps).size).toBe(3);
  });
});
