import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { findShopItem } from "../../data/shops";
import {
  atkFrom,
  defFrom,
  spdFrom,
  xpToNext,
} from "../../engine/combat/resolution";
import { classSkills, type SkillDef } from "../../engine/combat/skills";
import type { BattleState } from "../../engine/combat/types";
import {
  battleItemEffectLabel,
  isUsableBattleItem,
} from "../../engine/loot/consumables";
import type { GameEvent, GameState } from "../../engine/state/types";
import { MessageLog } from "../components/MessageLog";
import { Screen, useScreenContent } from "../components/Screen";
import { normalizeInkKey } from "../hooks/normalizeInkKey";
import { theme } from "../theme";
import {
  ACTIONS,
  type BattleMode,
  type BattleUiState,
  INITIAL_BATTLE_UI_STATE,
  reduceBattleUi,
  resolveBattleIntent,
} from "./battle/interaction";
import {
  type EffectBadge,
  effectBadges,
  type PackedEnemies,
  packEnemyColumns,
} from "./battle/render";

export interface BattleScreenProps {
  state: GameState;
  dispatch: (event: GameEvent) => void;
}

const ENEMY_GAP = 4;
const LAYOUT_GAP = 2;

const BATTLE_LOG_MAX_WIDTH = 36;

export function BattleScreen({ state, dispatch }: BattleScreenProps) {
  const [battleUi, setBattleUi] = useState<BattleUiState>(
    INITIAL_BATTLE_UI_STATE,
  );

  const bs = state.battleState;
  const actor =
    state.party.find((m) => m.id === bs?.activeMemberId) ?? state.party[0];
  const knownSkills = classSkills(actor.classId);

  const aliveEnemies = bs ? bs.enemies.filter((enemy) => enemy.hp > 0) : [];
  const usableItems = state.inventory.filter((entry) =>
    isUsableBattleItem(entry.itemId),
  );

  useInput((input, key) => {
    if (bs?.status !== "ongoing" || !bs?.awaitingCommand) return;

    const keyName = normalizeInkKey(input, key);
    if (!keyName) return;
    const intent = resolveBattleIntent(keyName);
    if (!intent) return;

    const result = reduceBattleUi(battleUi, intent, {
      actorId: actor.id,
      actorMp: actor.mp,
      knownSkills,
      aliveEnemyIds: aliveEnemies.map((enemy) => enemy.id),
      usableItemIds: usableItems.map((entry) => entry.itemId),
    });

    switch (result.effect?.type) {
      case "defend":
        dispatch({ type: "BattleDefend" });
        break;
      case "flee":
        dispatch({ type: "BattleFlee" });
        break;
      case "attack":
        dispatch({ type: "BattleAttack", targetId: result.effect.targetId });
        break;
      case "skill":
        dispatch({
          type: "BattleSkill",
          skillId: result.effect.skillId,
          targetId: result.effect.targetId,
        });
        break;
      case "item":
        dispatch({
          type: "BattleItem",
          itemId: result.effect.itemId,
          targetId: result.effect.targetId,
        });
        break;
      default:
        break;
    }

    setBattleUi(result.state);
  });

  if (!bs) {
    return (
      <Screen state={state} title="Battle">
        <Text color={theme.textMuted}>
          (no active battle - press 2 for the overworld)
        </Text>
      </Screen>
    );
  }

  return (
    <Screen
      state={state}
      title="Battle"
      hint={hintFor(battleUi.mode, usableItems.length)}
      showLog={false}
    >
      <BattleBody
        state={state}
        bs={bs}
        actor={actor}
        aliveEnemies={aliveEnemies}
        usableItems={usableItems}
        mode={battleUi.mode}
        actionCursor={battleUi.actionCursor}
        skillCursor={battleUi.skillCursor}
        itemCursor={battleUi.itemCursor}
        targetCursor={battleUi.targetCursor}
        skills={knownSkills}
      />
    </Screen>
  );
}

interface BattleBodyProps {
  state: GameState;
  bs: BattleState;
  actor: GameState["party"][number];
  aliveEnemies: BattleState["enemies"];
  usableItems: GameState["inventory"];
  mode: BattleMode;
  actionCursor: number;
  skillCursor: number;
  itemCursor: number;
  targetCursor: number;
  skills: readonly SkillDef[];
}

function BattleBody({
  state,
  bs,
  actor,
  aliveEnemies,
  usableItems,
  mode,
  actionCursor,
  skillCursor,
  itemCursor,
  targetCursor,
  skills,
}: BattleBodyProps) {
  const { width, height } = useScreenContent();

  const logWidth = Math.min(BATTLE_LOG_MAX_WIDTH, Math.floor(width * 0.4));
  const viewportWidth = Math.max(1, width - logWidth - LAYOUT_GAP);

  const viewportHeight = Math.max(1, height - 2);

  const packed = packEnemyColumns(
    bs.enemies,
    aliveEnemies,
    mode === "target",
    targetCursor,
    {
      columns: Math.max(1, viewportWidth - 2),
      gap: ENEMY_GAP,
    },
  );

  return (
    <Box flexDirection="row" gap={LAYOUT_GAP} height={height}>
      {}
      <Box flexDirection="column" width={viewportWidth}>
        <Box
          height={viewportHeight}
          position="relative"
          borderStyle="single"
          borderColor={theme.border}
          overflow="hidden"
        >
          <Box flexGrow={1} alignItems="center" justifyContent="center">
            <EnemyField packed={packed} />
          </Box>

          {}
          <Box
            position="absolute"
            bottom={0}
            left={0}
            flexDirection="column"
            borderStyle="round"
            borderColor={theme.borderFocus}
            paddingX={1}
          >
            <Text bold color={theme.accent}>
              {actor.name}
            </Text>
            <StatusBadgeRow badges={effectBadges(actor.effects)} />
            <ActionMenu
              mode={mode}
              actions={ACTIONS}
              actionCursor={actionCursor}
              skills={skills}
              skillCursor={skillCursor}
              heroMp={actor.mp}
              usableItems={usableItems}
              itemCursor={itemCursor}
            />
          </Box>
        </Box>

        <Text>
          {actor.name} Lv{actor.level} | XP {actor.xp}/{xpToNext(actor.level)} |
          ATK {atkFrom(actor)} DEF {defFrom(actor)} SPD {spdFrom(actor)}
        </Text>
        <Text color={theme.textMuted}>
          Turn order: {initiativeNames(bs, state.party).join(" -> ")}
        </Text>
      </Box>

      {}
      <Box flexDirection="column" width={logWidth}>
        <Text color={theme.textMuted}>Battle Log</Text>
        <MessageLog
          messages={state.log}
          height={Math.max(3, height - 1)}
          width={logWidth}
        />
      </Box>
    </Box>
  );
}

function EnemyField({ packed }: { packed: PackedEnemies }) {
  return (
    <Box flexDirection="column" gap={1}>
      {packed.rows.map((row, rowIndex) => (
        <Box
          key={row[0]?.enemy.id ?? rowIndex}
          flexDirection="row"
          gap={ENEMY_GAP}
          justifyContent="center"
        >
          {row.map((col) => {
            const color = col.dead
              ? theme.textFaint
              : col.selected
                ? theme.accent
                : (col.enemy.color ?? theme.text);
            return (
              <Box key={col.enemy.id} flexDirection="column">
                <Text color={color}>{col.enemy.ascii.join("\n")}</Text>
                <Text bold color={color}>
                  {col.nameLine}
                </Text>
                <Text color={color}>{col.hpLine}</Text>
                <StatusBadgeRow badges={col.badges} />
              </Box>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}

function StatusBadgeRow({ badges }: { badges: readonly EffectBadge[] }) {
  if (badges.length === 0) return null;
  return (
    <Box flexDirection="row" gap={1}>
      {badges.map((badge) => (
        <Text key={badge.id} color={theme.statusEffect[badge.id]}>
          {badge.label}
        </Text>
      ))}
    </Box>
  );
}

interface ActionMenuProps {
  mode: BattleMode;
  actions: readonly string[];
  actionCursor: number;
  skills: readonly SkillDef[];
  skillCursor: number;
  heroMp: number;
  usableItems: GameState["inventory"];
  itemCursor: number;
}

function ActionMenu({
  mode,
  actions,
  actionCursor,
  skills,
  skillCursor,
  heroMp,
  usableItems,
  itemCursor,
}: ActionMenuProps) {
  if (mode === "skill") {
    return (
      <Box flexDirection="column">
        {skills.map((skill, index) => {
          const affordable = heroMp >= skill.mpCost;
          return (
            <Text
              color={
                index === skillCursor
                  ? theme.accent
                  : affordable
                    ? undefined
                    : theme.textFaint
              }
              key={skill.id}
            >
              {index === skillCursor ? "> " : "  "}
              {skill.name} - {skill.mpCost} MP{affordable ? "" : " (low MP)"}
            </Text>
          );
        })}
      </Box>
    );
  }

  if (mode === "item") {
    if (usableItems.length === 0) {
      return (
        <Box flexDirection="column">
          <Text color={theme.textFaint}>(no usable items)</Text>
        </Box>
      );
    }
    return (
      <Box flexDirection="column">
        {usableItems.map((entry, index) => (
          <Text
            color={index === itemCursor ? theme.accent : undefined}
            key={entry.itemId}
          >
            {index === itemCursor ? "> " : "  "}
            {findShopItem(entry.itemId)?.name ?? entry.itemId} x{entry.quantity}{" "}
            - {battleItemEffectLabel(entry.itemId)}
          </Text>
        ))}
      </Box>
    );
  }

  if (mode === "target") {
    return (
      <Box flexDirection="column">
        <Text bold>Select a target</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {actions.map((action, index) => (
        <Text
          color={index === actionCursor ? theme.accent : undefined}
          key={action}
        >
          {index === actionCursor ? "> " : "  "}
          {action}
        </Text>
      ))}
    </Box>
  );
}

function initiativeNames(
  battle: BattleState,
  party: GameState["party"],
): string[] {
  return battle.initiative.map((id) => {
    const member = party.find((m) => m.id === id);
    if (member) return member.name;
    const enemy = battle.enemies.find((entry) => entry.id === id);
    return enemy ? enemy.name : id;
  });
}

function hintFor(mode: BattleMode, usableItemCount: number): string {
  switch (mode) {
    case "action":
      return "Up/Down to choose, Enter to confirm.";
    case "skill":
      return "Up/Down to choose a skill, Enter to cast, Esc to go back.";
    case "item":
      return usableItemCount === 0
        ? "No usable items - Esc to go back."
        : "Up/Down to choose an item, Enter to use, Esc to go back.";
    case "target":
      return "Up/Down to choose a target, Enter to confirm, Esc to go back.";
  }
}
