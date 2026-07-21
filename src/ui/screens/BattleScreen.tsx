import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { findShopItem } from "../../data/shops";
import {
  atkFrom,
  battleItemHealAmount,
  defFrom,
  isBattleHealItem,
  spdFrom,
  xpToNext,
} from "../../engine/combat/resolution";
import { classSkills, type SkillDef } from "../../engine/combat/skills";
import type { BattleState } from "../../engine/combat/types";
import type { GameEvent, GameState } from "../../engine/state/types";
import { MessageLog } from "../components/MessageLog";
import { Screen, useScreenContent } from "../components/Screen";
import { theme } from "../theme";
import { type PackedEnemies, packEnemyColumns } from "./battle/render";

export interface BattleScreenProps {
  state: GameState;
  dispatch: (event: GameEvent) => void;
}

type Mode = "action" | "skill" | "item" | "target";

const ACTIONS = ["Attack", "Skill", "Item", "Defend", "Flee"] as const;
const ENEMY_GAP = 4;
const LAYOUT_GAP = 2;
/** Max width of the right-hand battle log panel; shrinks on narrow panes. */
const BATTLE_LOG_MAX_WIDTH = 36;

/**
 * Battle scene (PROJECT_PLAN Phase 4, ROG-10). First-person framing: the
 * enemy ASCII art faces the viewer while the party is represented by the
 * hero's stats, Wizardry/Dragon Quest style. Everything is driven from
 * `state.battleState` plus `state.party`/`state.inventory`; key presses only
 * dispatch the pure battle events. A player command resolves a whole round in
 * the reducer, so after each dispatch the battle either continues (back to the
 * action menu) or the scene changes and this screen unmounts.
 */
export function BattleScreen({ state, dispatch }: BattleScreenProps) {
  const [mode, setMode] = useState<Mode>("action");
  const [actionCursor, setActionCursor] = useState(0);
  const [skillCursor, setSkillCursor] = useState(0);
  const [itemCursor, setItemCursor] = useState(0);
  const [targetCursor, setTargetCursor] = useState(0);
  const [pendingSkill, setPendingSkill] = useState<string | null>(null);

  const bs = state.battleState;
  const hero = state.party[0];
  const knownSkills = classSkills(hero.classId);

  const reset = () => {
    setMode("action");
    setActionCursor(0);
    setSkillCursor(0);
    setItemCursor(0);
    setTargetCursor(0);
    setPendingSkill(null);
  };

  const aliveEnemies = bs ? bs.enemies.filter((enemy) => enemy.hp > 0) : [];
  const healItems = state.inventory.filter((entry) =>
    isBattleHealItem(entry.itemId),
  );

  useInput((_input, key) => {
    if (bs?.status !== "ongoing" || !bs?.awaitingCommand) return;

    const up = key.upArrow;
    const down = key.downArrow;

    if (key.escape && mode !== "action") {
      setMode("action");
      setPendingSkill(null);
      return;
    }

    if (mode === "action") {
      if (up) setActionCursor((c) => (c + ACTIONS.length - 1) % ACTIONS.length);
      else if (down) setActionCursor((c) => (c + 1) % ACTIONS.length);
      else if (key.return) {
        switch (ACTIONS[actionCursor]) {
          case "Attack":
            setMode("target");
            setTargetCursor(0);
            setPendingSkill(null);
            break;
          case "Skill":
            setMode("skill");
            setSkillCursor(0);
            break;
          case "Item":
            setMode("item");
            setItemCursor(0);
            break;
          case "Defend":
            dispatch({ type: "BattleDefend" });
            reset();
            break;
          case "Flee":
            dispatch({ type: "BattleFlee" });
            reset();
            break;
        }
      }
      return;
    }

    if (mode === "skill") {
      if (up)
        setSkillCursor(
          (c) => (c + knownSkills.length - 1) % knownSkills.length,
        );
      else if (down) setSkillCursor((c) => (c + 1) % knownSkills.length);
      else if (key.return) {
        const skill = knownSkills[skillCursor];
        if (hero.mp >= skill.mpCost) {
          if (skill.target === "enemy") {
            setMode("target");
            setTargetCursor(0);
            setPendingSkill(skill.id);
          } else {
            dispatch({
              type: "BattleSkill",
              skillId: skill.id,
              targetId: hero.id,
            });
            reset();
          }
        }
      }
      return;
    }

    if (mode === "item") {
      if (healItems.length === 0) return;
      if (up)
        setItemCursor((c) => (c + healItems.length - 1) % healItems.length);
      else if (down) setItemCursor((c) => (c + 1) % healItems.length);
      else if (key.return) {
        const item = healItems[itemCursor];
        if (item) {
          dispatch({
            type: "BattleItem",
            itemId: item.itemId,
            targetId: hero.id,
          });
          reset();
        }
      }
      return;
    }

    // mode === "target"
    if (aliveEnemies.length === 0) {
      setMode("action");
      return;
    }
    if (up)
      setTargetCursor(
        (c) => (c + aliveEnemies.length - 1) % aliveEnemies.length,
      );
    else if (down) setTargetCursor((c) => (c + 1) % aliveEnemies.length);
    else if (key.return) {
      const target = aliveEnemies[targetCursor];
      if (target) {
        if (pendingSkill) {
          dispatch({
            type: "BattleSkill",
            skillId: pendingSkill,
            targetId: target.id,
          });
        } else {
          dispatch({ type: "BattleAttack", targetId: target.id });
        }
        reset();
      }
    }
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
      hint={hintFor(mode, healItems.length)}
      showLog={false}
    >
      <BattleBody
        state={state}
        bs={bs}
        aliveEnemies={aliveEnemies}
        healItems={healItems}
        mode={mode}
        actionCursor={actionCursor}
        skillCursor={skillCursor}
        itemCursor={itemCursor}
        targetCursor={targetCursor}
        skills={knownSkills}
      />
    </Screen>
  );
}

interface BattleBodyProps {
  state: GameState;
  bs: BattleState;
  aliveEnemies: BattleState["enemies"];
  healItems: GameState["inventory"];
  mode: Mode;
  actionCursor: number;
  skillCursor: number;
  itemCursor: number;
  targetCursor: number;
  skills: readonly SkillDef[];
}

function BattleBody({
  state,
  bs,
  aliveEnemies,
  healItems,
  mode,
  actionCursor,
  skillCursor,
  itemCursor,
  targetCursor,
  skills,
}: BattleBodyProps) {
  const { width, height } = useScreenContent();
  const hero = state.party[0];

  const logWidth = Math.min(BATTLE_LOG_MAX_WIDTH, Math.floor(width * 0.4));
  const viewportWidth = Math.max(1, width - logWidth - LAYOUT_GAP);
  // The framed viewport sits above the hero stat and turn-order lines.
  const viewportHeight = Math.max(1, height - 2);

  const packed = packEnemyColumns(
    bs.enemies,
    aliveEnemies,
    mode === "target",
    targetCursor,
    { columns: Math.max(1, viewportWidth - 2), gap: ENEMY_GAP },
  );

  return (
    <Box flexDirection="row" gap={LAYOUT_GAP} height={height}>
      {/* Left column: a framed battle viewport sized only from the pane; the
          command menu floats over it, out of flow, so it never reflows. */}
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

          {/* Floating command window, anchored bottom-left over the viewport
              and titled with the acting member: these actions are theirs. */}
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
              {hero.name}
            </Text>
            <ActionMenu
              mode={mode}
              actions={ACTIONS}
              actionCursor={actionCursor}
              skills={skills}
              skillCursor={skillCursor}
              heroMp={hero.mp}
              healItems={healItems}
              itemCursor={itemCursor}
            />
          </Box>
        </Box>

        <Text>
          {hero.name} Lv{hero.level} | XP {hero.xp}/{xpToNext(hero.level)} | ATK{" "}
          {atkFrom(hero)} DEF {defFrom(hero)} SPD {spdFrom(hero)}
        </Text>
        <Text color={theme.textMuted}>
          Turn order: {initiativeNames(bs, hero.name).join(" -> ")}
        </Text>
      </Box>

      {/* Battle log, pinned to the right of the combat layout. */}
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
                : undefined;
            return (
              <Box key={col.enemy.id} flexDirection="column">
                <Text color={color}>{col.enemy.ascii.join("\n")}</Text>
                <Text bold color={color}>
                  {col.nameLine}
                </Text>
                <Text color={color}>{col.hpLine}</Text>
              </Box>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}

interface ActionMenuProps {
  mode: Mode;
  actions: readonly string[];
  actionCursor: number;
  skills: readonly SkillDef[];
  skillCursor: number;
  heroMp: number;
  healItems: GameState["inventory"];
  itemCursor: number;
}

function ActionMenu({
  mode,
  actions,
  actionCursor,
  skills,
  skillCursor,
  heroMp,
  healItems,
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
    if (healItems.length === 0) {
      return (
        <Box flexDirection="column">
          <Text color={theme.textFaint}>(no usable items)</Text>
        </Box>
      );
    }
    return (
      <Box flexDirection="column">
        {healItems.map((entry, index) => (
          <Text
            color={index === itemCursor ? theme.accent : undefined}
            key={entry.itemId}
          >
            {index === itemCursor ? "> " : "  "}
            {findShopItem(entry.itemId)?.name ?? entry.itemId} x{entry.quantity}{" "}
            - heal {battleItemHealAmount(entry.itemId)}
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

/** Map initiative combatant ids to display names for the turn-order line. */
function initiativeNames(battle: BattleState, heroName: string): string[] {
  return battle.initiative.map((id) => {
    if (id === "hero-1") return heroName;
    const enemy = battle.enemies.find((entry) => entry.id === id);
    return enemy ? enemy.name : id;
  });
}

function hintFor(mode: Mode, healItemCount: number): string {
  switch (mode) {
    case "action":
      return "Up/Down to choose, Enter to confirm.";
    case "skill":
      return "Up/Down to choose a skill, Enter to cast, Esc to go back.";
    case "item":
      return healItemCount === 0
        ? "No usable items - Esc to go back."
        : "Up/Down to choose an item, Enter to use, Esc to go back.";
    case "target":
      return "Up/Down to choose a target, Enter to confirm, Esc to go back.";
  }
}
