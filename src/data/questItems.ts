export interface QuestItemDef {
  id: string;
  name: string;

  // Monster id (see src/data/monsters.ts) that can drop this on victory.
  sourceMonsterId: string;

  // Per-kill drop chance, rolled by the Phase 2 victory hook (ENG-36) only
  // when an accepted fetch quest still needs the item -- no dead RNG draws.
  dropChance: number;
}

export const QUEST_ITEMS: readonly QuestItemDef[] = [
  {
    id: "slime-gel",
    name: "Slime Gel",
    sourceMonsterId: "slime",
    dropChance: 0.5,
  },
  {
    id: "goblin-ear",
    name: "Goblin Ear",
    sourceMonsterId: "goblin",
    dropChance: 0.35,
  },
];

export function findQuestItem(id: string): QuestItemDef | undefined {
  return QUEST_ITEMS.find((item) => item.id === id);
}
