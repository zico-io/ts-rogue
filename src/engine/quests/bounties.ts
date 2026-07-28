import { DUNGEONS } from "../../data/dungeons";
import { findMonster, MONSTERS } from "../../data/monsters";
import { QUEST_ITEMS } from "../../data/questItems";
import type { QuestDef } from "../../data/quests";
import type { Rng } from "../rng/rng";

const BOUNTY_COUNT_RANGE = [2, 3] as const;
const KILL_COUNT_RANGE = [2, 5] as const;
const FETCH_COUNT_RANGE = [2, 4] as const;

export const KILL_BOUNTY_GOLD_MULTIPLIER = 2;
export const KILL_BOUNTY_XP_MULTIPLIER = 2;
export const FETCH_BOUNTY_BASE_GOLD = 8;
export const FETCH_BOUNTY_BASE_XP = 4;

// Bosses (see DUNGEONS[].bossId) are cleared via a "clear" quest, never a
// kill bounty, so they're excluded the same way pickEnemyGroup excludes them
// from wandering encounters (src/engine/combat/resolution.ts).
const BOSS_IDS = new Set(DUNGEONS.map((dungeon) => dungeon.bossId));

function eligibleMonsters(heroLevel: number) {
  const floor = Math.max(1, heroLevel);
  return MONSTERS.filter(
    (monster) => monster.minFloor <= floor && !BOSS_IDS.has(monster.id),
  );
}

function eligibleQuestItems(heroLevel: number) {
  const monsterIds = new Set(eligibleMonsters(heroLevel).map((m) => m.id));
  return QUEST_ITEMS.filter((item) => monsterIds.has(item.sourceMonsterId));
}

function killBounty(rng: Rng, heroLevel: number, id: string): QuestDef | null {
  const monsters = eligibleMonsters(heroLevel);
  if (monsters.length === 0) return null;
  const monster = rng.pick(monsters);
  const count = rng.int(...KILL_COUNT_RANGE);
  return {
    id,
    title: `Bounty: Cull the ${monster.name}s`,
    description: `The Guild is paying a bounty for ${count} ${monster.name}${
      count === 1 ? "" : "s"
    } slain.`,
    minLevel: Math.max(1, heroLevel),
    objective: { type: "kill", monsterId: monster.id, count },
    reward: {
      gold: Math.round(count * monster.gold * KILL_BOUNTY_GOLD_MULTIPLIER),
      xp: Math.round(count * monster.xp * KILL_BOUNTY_XP_MULTIPLIER),
    },
    repeatable: true,
  };
}

function fetchBounty(rng: Rng, heroLevel: number, id: string): QuestDef | null {
  const items = eligibleQuestItems(heroLevel);
  if (items.length === 0) return null;
  const item = rng.pick(items);
  const count = rng.int(...FETCH_COUNT_RANGE);
  const monster = findMonster(item.sourceMonsterId);
  return {
    id,
    title: `Bounty: ${item.name} Order`,
    description: `The Guild wants ${count} ${item.name}${
      count === 1 ? "" : "s"
    } delivered${monster ? `, dropped by ${monster.name}s` : ""}.`,
    minLevel: Math.max(1, heroLevel),
    objective: { type: "fetch", questItemId: item.id, count },
    reward: {
      // Scarcer drops (lower dropChance) pay more per unit than plentiful ones.
      gold: Math.round((count * FETCH_BOUNTY_BASE_GOLD) / item.dropChance),
      xp: Math.round((count * FETCH_BOUNTY_BASE_XP) / item.dropChance),
    },
    repeatable: true,
  };
}

/** RNG-generates concrete repeatable kill/fetch bounties, scaled to hero
 * level/floor, mirroring generateRecruits (src/engine/entities/recruits.ts).
 * Synthetic ids are stable within a single call (`bounty-0`, `bounty-1`, ...)
 * so RefreshQuests can rebuild the board from scratch each time. */
export function generateBounties(rng: Rng, heroLevel: number): QuestDef[] {
  const count = rng.int(...BOUNTY_COUNT_RANGE);
  const bounties: QuestDef[] = [];
  for (let i = 0; i < count; i++) {
    const id = `bounty-${i}`;
    const wantsFetch = rng.next() < 0.5;
    const primary = wantsFetch
      ? fetchBounty(rng, heroLevel, id)
      : killBounty(rng, heroLevel, id);
    const bounty =
      primary ??
      (wantsFetch
        ? killBounty(rng, heroLevel, id)
        : fetchBounty(rng, heroLevel, id));
    if (bounty) bounties.push(bounty);
  }
  return bounties;
}
