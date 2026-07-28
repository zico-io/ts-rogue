import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { findClass } from "../../data/classes";
import type { SkillNodeDef, SkillTreeDef } from "../../data/skillTrees";
import { findSkill } from "../../engine/combat/skills";
import {
  memberSkillTree,
  type SkillNodeState,
  skillNodeState,
} from "../../engine/entities/skillTree";
import type { GameEvent, GameState } from "../../engine/state/types";
import { Screen } from "../components/Screen";
import { normalizeInkKey } from "../hooks/normalizeInkKey";
import { theme } from "../theme";
import {
  INITIAL_SKILL_TREE_UI_STATE,
  reduceSkillTreeUi,
  resolveSkillTreeIntent,
} from "./skillTree/interaction";

export interface SkillTreeScreenProps {
  state: GameState;
  dispatch: (event: GameEvent) => void;
  onClose: () => void;
}

const STATE_COLOR: Record<SkillNodeState, string> = {
  locked: theme.textFaint,
  unlockable: theme.heal,
  unlocked: theme.accent,
};

function grantLine(node: SkillNodeDef): string {
  if (node.type === "skill") {
    return findSkill(node.skillId)?.name ?? node.skillId;
  }
  return `${node.stat.toUpperCase()} +${node.amount}`;
}

function prereqNames(tree: SkillTreeDef, node: SkillNodeDef): string {
  if (node.prereqs.length === 0) return "none";
  return node.prereqs
    .map(
      (id) => tree.nodes.find((candidate) => candidate.id === id)?.name ?? id,
    )
    .join(", ");
}

export function SkillTreeScreen({
  state,
  dispatch,
  onClose,
}: SkillTreeScreenProps) {
  const [skillTreeUi, setSkillTreeUi] = useState(INITIAL_SKILL_TREE_UI_STATE);

  const clampedMemberIndex = Math.min(
    skillTreeUi.memberIndex,
    state.party.length - 1,
  );
  const member = state.party[clampedMemberIndex];
  const cls = findClass(member.classId);
  const tree = memberSkillTree(member);
  const nodes = tree?.nodes ?? [];
  const nodeStates = nodes.map((node) => skillNodeState(member, node));
  const cursor = Math.min(skillTreeUi.cursor, Math.max(0, nodes.length - 1));

  useInput((input, key) => {
    const keyName = normalizeInkKey(input, key);
    if (!keyName) return;
    const intent = resolveSkillTreeIntent(keyName);
    if (!intent) return;

    const result = reduceSkillTreeUi(skillTreeUi, intent, {
      partyLength: state.party.length,
      nodes,
      nodeStates,
    });

    switch (result.effect?.type) {
      case "unlock":
        dispatch({
          type: "UnlockSkillNode",
          memberId: member.id,
          nodeId: result.effect.nodeId,
        });
        break;
      case "back":
        onClose();
        break;
      default:
        break;
    }

    setSkillTreeUi(result.state);
  });

  const switchHint =
    state.party.length > 1 ? " Left/Right to switch member." : "";

  return (
    <Screen
      state={state}
      title="Skill Tree"
      hint={`Up/down to select, Enter to unlock, Esc to close.${switchHint}`}
    >
      <Box flexDirection="column">
        <Text>
          {member.name} - {cls?.name ?? member.classId} - Skill points:{" "}
          {member.skillPoints}
        </Text>
        {!tree ? (
          <Text color={theme.textMuted}>
            No skill tree yet for this class (starter trees ship in ENG-35).
          </Text>
        ) : (
          nodes.map((node, index) => {
            const selected = index === cursor;
            const nodeState = nodeStates[index];
            return (
              <Text
                color={selected ? theme.accent : STATE_COLOR[nodeState]}
                key={node.id}
              >
                {selected ? "> " : "  "}
                {node.name} (cost {node.cost}) - {grantLine(node)} - prereqs:{" "}
                {prereqNames(tree, node)} - {nodeState}
              </Text>
            );
          })
        )}
      </Box>
    </Screen>
  );
}
