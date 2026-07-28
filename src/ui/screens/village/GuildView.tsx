import { Box, Text, useInput } from "ink";
import { useEffect, useState } from "react";
import { findDungeon } from "../../../data/dungeons";
import { findMonster } from "../../../data/monsters";
import { findQuestItem } from "../../../data/questItems";
import type { QuestDef, QuestObjective } from "../../../data/quests";
import { findShopItem } from "../../../data/shops";
import { isQuestComplete } from "../../../engine/quests";
import type {
  AcceptedQuest,
  GameEvent,
  GameState,
} from "../../../engine/state/types";
import { Screen } from "../../components/Screen";
import { normalizeInkKey } from "../../hooks/normalizeInkKey";
import { theme } from "../../theme";
import {
  type GuildUiState,
  INITIAL_GUILD_UI_STATE,
  reduceGuildUi,
  resolveGuildIntent,
} from "./interaction";

export interface GuildViewProps {
  state: GameState;
  dispatch: (event: GameEvent) => void;
  onBack: () => void;
}

export function GuildView({ state, dispatch, onBack }: GuildViewProps) {
  const [guildUi, setGuildUi] = useState<GuildUiState>(INITIAL_GUILD_UI_STATE);

  useEffect(() => {
    if (state.quests.available.length === 0) {
      dispatch({ type: "RefreshQuests" });
    }
  }, [state.quests.available.length, dispatch]);

  const availableIds = state.quests.available.map((quest) => quest.id);
  const acceptedRows = state.quests.accepted.map((quest) => ({
    id: quest.def.id,
    complete: isQuestComplete(quest, state.questItems),
  }));

  useInput((input, key) => {
    const keyName = normalizeInkKey(input, key);
    if (!keyName) return;
    const intent = resolveGuildIntent(keyName);
    if (!intent) return;

    const result = reduceGuildUi(guildUi, intent, {
      availableIds,
      acceptedQuests: acceptedRows,
    });

    switch (result.effect?.type) {
      case "accept":
        dispatch({ type: "AcceptQuest", questId: result.effect.questId });
        break;
      case "turnIn":
        dispatch({ type: "TurnInQuest", questId: result.effect.questId });
        break;
      case "back":
        onBack();
        break;
      default:
        break;
    }

    setGuildUi(result.state);
  });

  const availableIndex = Math.min(
    guildUi.availableCursor,
    Math.max(0, state.quests.available.length - 1),
  );
  const acceptedIndex = Math.min(
    guildUi.acceptedCursor,
    Math.max(0, state.quests.accepted.length - 1),
  );

  return (
    <Screen
      state={state}
      title={`Guild - ${guildUi.mode === "available" ? "Available" : "Accepted"}`}
      hint={
        guildUi.mode === "available"
          ? "Up/down to select, Enter to accept, Tab for accepted, Esc to go back."
          : "Up/down to select, Enter to turn in when ready, Tab for available, Esc to go back."
      }
    >
      {guildUi.mode === "available" ? (
        <AvailableList
          cursor={availableIndex}
          quests={state.quests.available}
        />
      ) : (
        <AcceptedList
          cursor={acceptedIndex}
          questItems={state.questItems}
          quests={state.quests.accepted}
        />
      )}
    </Screen>
  );
}

function describeObjective(objective: QuestObjective): string {
  switch (objective.type) {
    case "kill": {
      const monster = findMonster(objective.monsterId);
      return `Kill ${objective.count} ${monster?.name ?? objective.monsterId}`;
    }
    case "clear": {
      const dungeon = findDungeon(objective.dungeonId);
      return `Clear ${dungeon?.name ?? objective.dungeonId}`;
    }
    case "fetch": {
      const item = findQuestItem(objective.questItemId);
      return `Fetch ${objective.count} ${item?.name ?? objective.questItemId}`;
    }
  }
}

function describeReward(reward: QuestDef["reward"]): string {
  const itemName = reward.itemId
    ? (findShopItem(reward.itemId)?.name ?? reward.itemId)
    : undefined;
  const itemPart = itemName ? ` + ${itemName}` : "";
  return `${reward.gold}g, ${reward.xp}xp${itemPart}`;
}

function describeProgress(
  quest: AcceptedQuest,
  questItems: Readonly<Record<string, number>>,
): string {
  const { objective } = quest.def;
  switch (objective.type) {
    case "kill":
      return `kill ${Math.min(quest.progress, objective.count)}/${objective.count}`;
    case "clear":
      return quest.progress >= 1 ? "cleared" : "not cleared";
    case "fetch": {
      const have = questItems[objective.questItemId] ?? 0;
      return `fetch ${Math.min(have, objective.count)}/${objective.count}`;
    }
  }
}

interface AvailableListProps {
  quests: readonly QuestDef[];
  cursor: number;
}

function AvailableList({ quests, cursor }: AvailableListProps) {
  if (quests.length === 0) {
    return (
      <Text color={theme.textMuted}>The quest board is empty right now.</Text>
    );
  }
  return (
    <Box flexDirection="column">
      {quests.map((quest, index) => (
        <Text
          color={index === cursor ? theme.accent : undefined}
          key={quest.id}
        >
          {index === cursor ? "> " : "  "}
          {quest.title} - {describeObjective(quest.objective)} -{" "}
          <Text color={theme.gold}>{describeReward(quest.reward)}</Text>
        </Text>
      ))}
    </Box>
  );
}

interface AcceptedListProps {
  quests: readonly AcceptedQuest[];
  questItems: Readonly<Record<string, number>>;
  cursor: number;
}

function AcceptedList({ quests, questItems, cursor }: AcceptedListProps) {
  if (quests.length === 0) {
    return (
      <Text color={theme.textMuted}>
        You have no quests accepted. Visit the board to pick one up.
      </Text>
    );
  }
  return (
    <Box flexDirection="column">
      {quests.map((quest, index) => {
        const complete = isQuestComplete(quest, questItems);
        return (
          <Text
            color={
              index === cursor
                ? theme.accent
                : complete
                  ? theme.gold
                  : undefined
            }
            key={quest.def.id}
          >
            {index === cursor ? "> " : "  "}
            {quest.def.title} - {describeProgress(quest, questItems)}
            {complete ? " - ready to turn in!" : ""}
          </Text>
        );
      })}
    </Box>
  );
}
