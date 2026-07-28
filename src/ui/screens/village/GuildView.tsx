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
  clampGuildCursor,
  type GuildRow,
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

// A single combined row list -- accepted quests (with live progress) first,
// then the available board -- so accepting and turning in both happen from
// one pane instead of a Tab-gated mode switch.
type DisplayRow =
  | { kind: "accepted"; quest: AcceptedQuest; complete: boolean }
  | { kind: "available"; quest: QuestDef };

function buildDisplayRows(state: GameState): DisplayRow[] {
  return [
    ...state.quests.accepted.map(
      (quest): DisplayRow => ({
        kind: "accepted",
        quest,
        complete: isQuestComplete(quest, state.questItems),
      }),
    ),
    ...state.quests.available.map(
      (quest): DisplayRow => ({ kind: "available", quest }),
    ),
  ];
}

function toGuildRow(row: DisplayRow): GuildRow {
  return row.kind === "accepted"
    ? { kind: "accepted", id: row.quest.def.id, complete: row.complete }
    : { kind: "available", id: row.quest.id, complete: false };
}

export function GuildView({ state, dispatch, onBack }: GuildViewProps) {
  const [guildUi, setGuildUi] = useState<GuildUiState>(INITIAL_GUILD_UI_STATE);

  useEffect(() => {
    if (state.quests.available.length === 0) {
      dispatch({ type: "RefreshQuests" });
    }
  }, [state.quests.available.length, dispatch]);

  const displayRows = buildDisplayRows(state);

  useInput((input, key) => {
    const keyName = normalizeInkKey(input, key);
    if (!keyName) return;
    const intent = resolveGuildIntent(keyName);
    if (!intent) return;

    const result = reduceGuildUi(guildUi, intent, {
      rows: displayRows.map(toGuildRow),
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

  const cursor = clampGuildCursor(guildUi.cursor, displayRows.length);

  return (
    <Screen
      hint="Up/down to select, Enter to accept an available quest or turn in a ready one, Esc to go back."
      state={state}
      title="Guild"
    >
      <QuestList
        cursor={cursor}
        questItems={state.questItems}
        rows={displayRows}
      />
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

interface QuestListProps {
  rows: readonly DisplayRow[];
  questItems: Readonly<Record<string, number>>;
  cursor: number;
}

function QuestList({ rows, questItems, cursor }: QuestListProps) {
  if (rows.length === 0) {
    return (
      <Text color={theme.textMuted}>The quest board is empty right now.</Text>
    );
  }
  return (
    <Box flexDirection="column">
      {rows.map((row, index) => (
        <QuestRow
          index={index}
          isCursor={index === cursor}
          key={row.kind === "accepted" ? row.quest.def.id : row.quest.id}
          questItems={questItems}
          row={row}
        />
      ))}
    </Box>
  );
}

interface QuestRowProps {
  row: DisplayRow;
  index: number;
  isCursor: boolean;
  questItems: Readonly<Record<string, number>>;
}

function QuestRow({ row, isCursor, questItems }: QuestRowProps) {
  const cursorGlyph = isCursor ? "> " : "  ";

  if (row.kind === "available") {
    const { quest } = row;
    return (
      <Text color={isCursor ? theme.accent : undefined}>
        {cursorGlyph}
        {quest.title} - {describeObjective(quest.objective)} -{" "}
        <Text color={theme.gold}>{describeReward(quest.reward)}</Text>
      </Text>
    );
  }

  const { quest, complete } = row;
  return (
    <Text color={isCursor ? theme.accent : complete ? theme.gold : undefined}>
      {cursorGlyph}
      {quest.def.title} - {describeProgress(quest, questItems)}
      {complete ? " - ready to turn in!" : ""}
    </Text>
  );
}
