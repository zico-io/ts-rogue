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
    const packed = packEnemyColumns(enemies, enemies, false, 0, {
      columns: 64,
    });
    expect(packed.rows).toHaveLength(1);
    expect(packed.rows[0]).toHaveLength(3);

    expect(packed.fieldWidth).toBe(35);
    expect(packed.fieldHeight).toBe(6);
  });

  it("wraps to one column per row when the terminal is narrow", () => {
    const enemies = goblins(3);
    const packed = packEnemyColumns(enemies, enemies, false, 0, {
      columns: 20,
    });

    expect(packed.rows).toHaveLength(3);
    for (const row of packed.rows) expect(row).toHaveLength(1);

    expect(packed.fieldHeight).toBe(23);
    expect(packed.fieldWidth).toBe(9);
  });

  it("packs two per row then one when there is room for two", () => {
    const enemies = goblins(3);
    const packed = packEnemyColumns(enemies, enemies, false, 0, {
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
      const packed = packEnemyColumns(enemies, enemies, false, 0, { columns });
      expect(packed.fieldWidth).toBeLessThanOrEqual(columns);
    }
  });

  it("marks the targeted enemy column as selected", () => {
    const enemies = slimes(3);
    const packed = packEnemyColumns(enemies, enemies, true, 1, {
      columns: 64,
    });
    expect(packed.rows[0][0].selected).toBe(false);
    expect(packed.rows[0][1].selected).toBe(true);
    expect(packed.rows[0][1].nameLine).toBe("> Slime");
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
    const packed = packEnemyColumns([guardian], [guardian], false, 0, {
      columns: 64,
    });
    expect(packed.rows).toHaveLength(1);
    expect(packed.rows[0]).toHaveLength(1);
    expect(packed.fieldHeight).toBe(6 + 2);
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
