import { describe, expect, it } from "vitest";
import type { BattleEnemy } from "../../../engine/combat/types";
import {
  effectBadges,
  enemyColumnHeight,
  enemyColumnWidth,
  enemyHpLine,
  enemyNameLine,
  packEnemyColumns,
} from "./render";

function makeEnemy(
  id: string,
  name: string,
  ascii: readonly string[],
  hp = 12,
  maxHp = 12,
  row?: "front" | "back",
): BattleEnemy {
  return {
    id,
    defId: id,
    name,
    hp,
    maxHp,
    stats: { str: 1, agi: 1, vit: 1, int: 1 },
    ascii,
    xp: 1,
    gold: 1,
    row,
  };
}

const SLIME_ASCII = ["   ___   ", "  /   \\  ", " | ~o~ | ", "  \\___/  "];
const GOBLIN_ASCII = [
  "   /\\    ",
  "  /oo\\   ",
  "  \\--/   ",
  "  /||\\   ",
  " /    \\  ",
];

function slimes(n: number): BattleEnemy[] {
  return Array.from({ length: n }, (_, i) =>
    makeEnemy(`slime-${i + 1}`, "Slime", SLIME_ASCII),
  );
}

function goblins(n: number): BattleEnemy[] {
  return Array.from({ length: n }, (_, i) =>
    makeEnemy(`goblin-${i + 1}`, "Goblin", GOBLIN_ASCII),
  );
}

describe("enemyNameLine / enemyHpLine", () => {
  it("prefixes the selected target and suffixes defeated enemies", () => {
    const slime = makeEnemy("slime-1", "Slime", SLIME_ASCII);
    expect(enemyNameLine(slime, true, false)).toBe("> Slime");
    expect(enemyNameLine(slime, false, false)).toBe("  Slime");
    expect(enemyNameLine(slime, false, true)).toBe("  Slime (defeated)");
  });

  it("suffixes a melee-unreachable enemy, but defers to defeated", () => {
    const slime = makeEnemy("slime-1", "Slime", SLIME_ASCII);
    expect(enemyNameLine(slime, false, false, true)).toBe(
      "  Slime (unreachable)",
    );
    expect(enemyNameLine(slime, false, true, true)).toBe("  Slime (defeated)");
  });

  it("renders HP as current over max", () => {
    expect(enemyHpLine(makeEnemy("slime-1", "Slime", SLIME_ASCII))).toBe(
      "HP 12/12",
    );
  });
});

describe("enemyColumnWidth / enemyColumnHeight", () => {
  it("is the widest of art, name, and HP; height is art plus two lines", () => {
    expect(
      enemyColumnWidth(
        makeEnemy("slime-1", "Slime", SLIME_ASCII),
        false,
        false,
      ),
    ).toBe(9);
    expect(enemyColumnHeight(makeEnemy("slime-1", "Slime", SLIME_ASCII))).toBe(
      4 + 2,
    );
    expect(
      enemyColumnHeight(makeEnemy("goblin-1", "Goblin", GOBLIN_ASCII)),
    ).toBe(5 + 2);
  });
});

describe("packEnemyColumns", () => {
  it("keeps three enemies on one row on a wide terminal", () => {
    const enemies = slimes(3);
    const packed = packEnemyColumns(enemies, new Set(), {
      columns: 64,
    });
    expect(packed.rows).toHaveLength(1);
    expect(packed.rows[0]).toHaveLength(3);

    expect(packed.fieldWidth).toBe(35);
    expect(packed.fieldHeight).toBe(6);
    expect(packed.formationBreakIndex).toBeNull();
  });

  it("wraps to one column per row when the terminal is narrow", () => {
    const enemies = goblins(3);
    const packed = packEnemyColumns(enemies, new Set(), {
      columns: 20,
    });

    expect(packed.rows).toHaveLength(3);
    for (const row of packed.rows) expect(row).toHaveLength(1);

    expect(packed.fieldHeight).toBe(23);
    expect(packed.fieldWidth).toBe(9);
  });

  it("packs two per row then one when there is room for two", () => {
    const enemies = goblins(3);
    const packed = packEnemyColumns(enemies, new Set(), {
      columns: 24,
    });
    expect(packed.rows).toHaveLength(2);
    expect(packed.rows[0]).toHaveLength(2);
    expect(packed.rows[1]).toHaveLength(1);

    expect(packed.fieldHeight).toBe(15);
    expect(packed.fieldWidth).toBe(22);
  });

  it("never lets a row exceed the terminal width", () => {
    const enemies = goblins(4);
    for (const columns of [16, 20, 24, 40, 64, 120]) {
      const packed = packEnemyColumns(enemies, new Set(), { columns });
      expect(packed.fieldWidth).toBeLessThanOrEqual(columns);
    }
  });

  it("marks every highlighted id as selected", () => {
    const enemies = slimes(3);
    const packed = packEnemyColumns(enemies, new Set([enemies[1].id]), {
      columns: 64,
    });
    expect(packed.rows[0][0].selected).toBe(false);
    expect(packed.rows[0][1].selected).toBe(true);
    expect(packed.rows[0][1].nameLine).toBe("> Slime");
  });

  it("highlights a whole shape's target list at once", () => {
    const enemies = slimes(3);
    const packed = packEnemyColumns(
      enemies,
      new Set([enemies[0].id, enemies[2].id]),
      { columns: 64 },
    );
    expect(packed.rows[0][0].selected).toBe(true);
    expect(packed.rows[0][1].selected).toBe(false);
    expect(packed.rows[0][2].selected).toBe(true);
  });

  it("handles a single boss enemy", () => {
    const guardian = makeEnemy(
      "boss-1",
      "Dungeon Guardian",
      [
        "  /===\\  ",
        "  |O O|  ",
        "  |___|  ",
        " /|||\\   ",
        " |   |   ",
        " /___\\   ",
      ],
      60,
      60,
    );
    const packed = packEnemyColumns([guardian], new Set(), {
      columns: 64,
    });
    expect(packed.rows).toHaveLength(1);
    expect(packed.rows[0]).toHaveLength(1);
    expect(packed.fieldHeight).toBe(6 + 2);
  });

  it("splits front and back row into separate visual blocks", () => {
    const enemies = [
      ...slimes(2).map((e) => ({ ...e, row: "front" as const })),
      makeEnemy("goblin-1", "Goblin", GOBLIN_ASCII, 12, 12, "back"),
    ];
    const packed = packEnemyColumns(enemies, new Set(), { columns: 64 });
    expect(packed.rows).toHaveLength(2);
    expect(packed.rows[0].map((c) => c.enemy.id)).toEqual([
      "slime-1",
      "slime-2",
    ]);
    expect(packed.rows[1].map((c) => c.enemy.id)).toEqual(["goblin-1"]);
    expect(packed.formationBreakIndex).toBe(1);
    expect(packed.rows[0].every((c) => c.formationRow === "front")).toBe(true);
    expect(packed.rows[1][0].formationRow).toBe("back");
  });

  it("flags a living back-row enemy as melee-unreachable while the front row lives", () => {
    const enemies = [
      makeEnemy("slime-1", "Slime", SLIME_ASCII, 12, 12, "front"),
      makeEnemy("goblin-1", "Goblin", GOBLIN_ASCII, 12, 12, "back"),
    ];
    const packed = packEnemyColumns(enemies, new Set(), { columns: 64 });
    expect(packed.rows[1][0].meleeUnreachable).toBe(true);

    const frontDead = [{ ...enemies[0], hp: 0 }, enemies[1]];
    const packedAfterFrontDies = packEnemyColumns(frontDead, new Set(), {
      columns: 64,
    });
    expect(packedAfterFrontDies.rows[1][0].meleeUnreachable).toBe(false);
  });
});

describe("effectBadges / afflicted enemy layout", () => {
  it("turns effect instances into labeled badges with turns remaining", () => {
    const badges = effectBadges([
      { effectId: "poison", duration: 2, potency: 1 },
      { effectId: "stun", duration: 1, potency: 1 },
    ]);
    expect(badges).toEqual([
      { id: "poison", label: "Poison x2" },
      { id: "stun", label: "Stun x1" },
    ]);
  });

  it("is empty for an unafflicted actor", () => {
    expect(effectBadges(undefined)).toEqual([]);
    expect(effectBadges([])).toEqual([]);
  });

  it("grows an afflicted enemy's column by one line for the badge row", () => {
    const slime = makeEnemy("slime-1", "Slime", SLIME_ASCII);
    const afflicted: BattleEnemy = {
      ...slime,
      effects: [{ effectId: "burn", duration: 2, potency: 1 }],
    };
    expect(enemyColumnHeight(slime)).toBe(4 + 2);
    expect(enemyColumnHeight(afflicted)).toBe(4 + 2 + 1);
  });

  it("widens an afflicted enemy's column when the badge line is the longest", () => {
    const slime = makeEnemy("slime-1", "Slime", SLIME_ASCII);
    const afflicted: BattleEnemy = {
      ...slime,
      effects: [
        { effectId: "poison", duration: 2, potency: 1 },
        { effectId: "shocked", duration: 1, potency: 1 },
      ],
    };
    expect(enemyColumnWidth(slime, false, false)).toBe(9);
    expect(enemyColumnWidth(afflicted, false, false)).toBeGreaterThan(9);
  });
});
