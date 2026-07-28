import { findQuestItem } from "../data/questItems";
import type { BattleEnemy } from "./combat/types";
import { entry, type LogEntry } from "./log";
import type { Rng } from "./rng/rng";
import type { AcceptedQuest, QuestState } from "./state/types";

/** Guild board cap: at most this many quests may be accepted at once. */
export const MAX_ACCEPTED_QUESTS = 3;

/** True once an accepted quest's objective has been fulfilled and it is ready to turn in. */
export function isQuestComplete(
  quest: AcceptedQuest,
  questItems: Readonly<Record<string, number>>,
): boolean {
  const { objective } = quest.def;
  switch (objective.type) {
    case "kill":
      return quest.progress >= objective.count;
    case "clear":
      return quest.progress >= 1;
    case "fetch":
      return (questItems[objective.questItemId] ?? 0) >= objective.count;
  }
}

export interface QuestVictoryAdvance {
  quests: QuestState;
  questItems: Record<string, number>;
  logs: LogEntry[];
}

/**
 * Advances accepted-quest progress after a won battle (called from
 * `finalizeWon`). `enemies` is the full defeated roster. Fetch-item rolls
 * only touch `rng` when an accepted, incomplete fetch quest actually wants
 * that item -- no dead RNG draws for quests nobody has taken.
 */
export function advanceQuestsOnVictory(
  quests: QuestState,
  questItems: Record<string, number>,
  enemies: readonly BattleEnemy[],
  wasBossVictory: boolean,
  dungeonId: string | null,
  rng: Rng,
): QuestVictoryAdvance {
  let nextQuestItems = questItems;
  const logs: LogEntry[] = [];

  const accepted = quests.accepted.map((quest) => {
    if (isQuestComplete(quest, questItems)) return quest;

    const { objective } = quest.def;
    let updated = quest;

    if (objective.type === "kill") {
      const kills = enemies.filter(
        (enemy) => enemy.defId === objective.monsterId,
      ).length;
      if (kills > 0) {
        const progress = Math.min(objective.count, quest.progress + kills);
        updated = { ...quest, progress };
      }
    } else if (objective.type === "clear") {
      if (wasBossVictory && objective.dungeonId === dungeonId) {
        updated = { ...quest, progress: 1 };
      }
    } else {
      const itemDef = findQuestItem(objective.questItemId);
      if (itemDef) {
        let gained = 0;
        for (const enemy of enemies) {
          if (enemy.defId !== itemDef.sourceMonsterId) continue;
          if (rng.next() < itemDef.dropChance) gained += 1;
        }
        if (gained > 0) {
          nextQuestItems = {
            ...nextQuestItems,
            [itemDef.id]: (nextQuestItems[itemDef.id] ?? 0) + gained,
          };
        }
      }
    }

    if (isQuestComplete(updated, nextQuestItems)) {
      logs.push(
        entry(
          `"${quest.def.title}" complete! Return to the Guild to turn it in.`,
          "quest",
        ),
      );
    }
    return updated;
  });

  return { quests: { ...quests, accepted }, questItems: nextQuestItems, logs };
}
