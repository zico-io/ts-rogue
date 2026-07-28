export interface QuestReward {
  gold: number;
  xp: number;

  // Shop item id (see src/data/shops.ts) granted on turn-in, if any.
  itemId?: string;
}

// Discriminated on `type`, matching the GameEvent idiom (src/engine/state/types.ts).
// Each variant carries the target its Phase 2 victory hook (ENG-36) advances
// progress against: a kill tally by monster id, a boss-clear flag for a
// dungeon, or a fetch-bag count for a quest item (see questItems.ts).
export type QuestObjective =
  | { type: "kill"; monsterId: string; count: number }
  | { type: "clear"; dungeonId: string }
  | { type: "fetch"; questItemId: string; count: number };

export interface QuestDef {
  id: string;
  title: string;
  description: string;

  // Hero level required before the Guild board offers this quest.
  minLevel: number;

  objective: QuestObjective;
  reward: QuestReward;

  // Repeatable quests skip completedIds bookkeeping so RefreshQuests
  // (ENG-37) can offer them again after turn-in. Static hand-authored
  // quests default to one-time; procedural bounties always set this true.
  repeatable?: boolean;
}

export const QUESTS: readonly QuestDef[] = [
  {
    id: "slime-cull",
    title: "Slime Cull",
    description: "The Guild wants the village outskirts cleared of slimes.",
    minLevel: 1,
    objective: { type: "kill", monsterId: "slime", count: 5 },
    reward: { gold: 40, xp: 20 },
  },
  {
    id: "goblin-warband",
    title: "Goblin Warband",
    description: "Thin out the goblin raiders harassing travelers.",
    minLevel: 2,
    objective: { type: "kill", monsterId: "goblin", count: 3 },
    reward: { gold: 60, xp: 35 },
  },
  {
    id: "clear-sunken-crypt",
    title: "Clear the Sunken Crypt",
    description: "Defeat the Sunken Crypt's guardian and clear the dungeon.",
    minLevel: 1,
    objective: { type: "clear", dungeonId: "sunken-crypt" },
    reward: { gold: 100, xp: 60, itemId: "leather-armor" },
  },
  {
    id: "fetch-slime-gel",
    title: "Slime Gel Order",
    description: "The alchemist needs slime gel for a new batch of potions.",
    minLevel: 1,
    objective: { type: "fetch", questItemId: "slime-gel", count: 3 },
    reward: { gold: 30, xp: 10, itemId: "potion" },
  },
];

export function findQuest(id: string): QuestDef | undefined {
  return QUESTS.find((quest) => quest.id === id);
}
