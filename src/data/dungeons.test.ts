import { describe, expect, it } from "vitest";
import {
  allStoryDungeonsCleared,
  DUNGEONS,
  dungeonDefFor,
  findDungeon,
  floorBandFor,
} from "./dungeons";
import { findLootTable } from "./lootTables";
import { findMonster } from "./monsters";

describe("DUNGEONS data table", () => {
  it("ships 3 story dungeons of distinct tiers", () => {
    expect(DUNGEONS).toHaveLength(3);
    expect(DUNGEONS.every((dungeon) => dungeon.story)).toBe(true);
    expect(new Set(DUNGEONS.map((dungeon) => dungeon.tier)).size).toBe(
      DUNGEONS.length,
    );
  });

  it("exposes findDungeon", () => {
    expect(findDungeon("sunken-crypt")?.name).toBe("Sunken Crypt");
    expect(findDungeon("nope")).toBeUndefined();
  });

  it("dungeonDefFor resolves known ids and falls back to DUNGEONS[0] for unmapped ids", () => {
    expect(dungeonDefFor("howling-cave").name).toBe("Howling Cave");
    expect(dungeonDefFor("some-unmapped-entrance-id")).toBe(DUNGEONS[0]);
  });

  it("floorBandFor picks the band covering the floor and clamps out-of-range floors", () => {
    const crypt = findDungeon("sunken-crypt");
    if (!crypt) throw new Error("sunken-crypt missing from DUNGEONS");
    expect(floorBandFor(crypt, 1).lootTableRef).toBe("tier-1");
    expect(floorBandFor(crypt, 2).lootTableRef).toBe("tier-1");
    expect(floorBandFor(crypt, 3).lootTableRef).toBe("tier-2");
    expect(floorBandFor(crypt, 0).lootTableRef).toBe("tier-1");
    expect(floorBandFor(crypt, 99).lootTableRef).toBe("tier-2");
  });

  it("every palette monster id resolves against the monster roster", () => {
    for (const dungeon of DUNGEONS) {
      for (const entry of dungeon.palette) {
        expect(
          findMonster(entry.monsterId),
          `${dungeon.id}: palette monster "${entry.monsterId}"`,
        ).toBeDefined();
      }
    }
  });

  it("every boss id resolves against the monster roster", () => {
    for (const dungeon of DUNGEONS) {
      expect(
        findMonster(dungeon.bossId),
        `${dungeon.id}: boss "${dungeon.bossId}"`,
      ).toBeDefined();
    }
  });

  it("every floor band loot ref resolves and covers 1..floorCount with no gaps", () => {
    for (const dungeon of DUNGEONS) {
      for (const band of dungeon.floorBands) {
        expect(
          findLootTable(band.lootTableRef),
          `${dungeon.id}: loot ref "${band.lootTableRef}"`,
        ).toBeDefined();
      }
      const sorted = [...dungeon.floorBands].sort(
        (a, b) => a.minFloor - b.minFloor,
      );
      expect(sorted[0].minFloor, `${dungeon.id}: first band`).toBe(1);
      expect(
        sorted[sorted.length - 1].maxFloor,
        `${dungeon.id}: last band`,
      ).toBe(dungeon.floorCount);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].minFloor, `${dungeon.id}: band gap at ${i}`).toBe(
          sorted[i - 1].maxFloor + 1,
        );
      }
    }
  });
});

describe("allStoryDungeonsCleared", () => {
  it("is false when no dungeons are cleared", () => {
    expect(allStoryDungeonsCleared({})).toBe(false);
  });

  it("stays false until the last story dungeon's boss falls", () => {
    const allButLast = DUNGEONS.slice(0, -1);
    const clearedAt = Object.fromEntries(
      allButLast.map((dungeon, i) => [dungeon.id, i + 1]),
    );
    expect(allStoryDungeonsCleared(clearedAt)).toBe(false);
  });

  it("flips true once every story dungeon has a clearedAt entry", () => {
    const clearedAt = Object.fromEntries(
      DUNGEONS.map((dungeon, i) => [dungeon.id, i + 1]),
    );
    expect(allStoryDungeonsCleared(clearedAt)).toBe(true);
  });

  it("ignores unrelated ids in the record", () => {
    const clearedAt = Object.fromEntries(
      DUNGEONS.map((dungeon, i) => [dungeon.id, i + 1]),
    );
    expect(allStoryDungeonsCleared({ ...clearedAt, "not-a-dungeon": 1 })).toBe(
      true,
    );
  });
});
