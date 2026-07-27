import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { findClass } from "../../data/classes";
import {
  atkFrom,
  defFrom,
  spdFrom,
  xpToNext,
} from "../../engine/combat/resolution";
import { classSkills } from "../../engine/combat/skills";
import { describeItem } from "../../engine/loot/items";
import type { GameState } from "../../engine/state/types";
import { Screen } from "../components/Screen";
import { normalizeInkKey } from "../hooks/normalizeInkKey";
import { theme } from "../theme";
import {
  buildStatRows,
  INITIAL_CHARACTER_UI_STATE,
  reduceCharacterUi,
  resolveCharacterIntent,
} from "./character/interaction";
import { EQUIP_SLOTS } from "./village/interaction";

export interface CharacterSheetScreenProps {
  state: GameState;
  onClose: () => void;
}

// Kept to a fixed, small row budget (one line per fact, no section
// headers or blank separators) so the full sheet still fits the 64x24
// minimum terminal size alongside the shared Screen chrome.
export function CharacterSheetScreen({
  state,
  onClose,
}: CharacterSheetScreenProps) {
  const [characterUi, setCharacterUi] = useState(INITIAL_CHARACTER_UI_STATE);
  const clampedMemberIndex = Math.min(
    characterUi.memberIndex,
    state.party.length - 1,
  );
  const member = state.party[clampedMemberIndex];
  const cls = findClass(member.classId);
  const skills = classSkills(member.classId);
  const statRows = buildStatRows(member);

  useInput((input, key) => {
    const keyName = normalizeInkKey(input, key);
    if (!keyName) return;
    const intent = resolveCharacterIntent(keyName);
    if (!intent) return;

    const result = reduceCharacterUi(characterUi, intent, {
      partyLength: state.party.length,
    });
    if (result.effect?.type === "back") onClose();
    setCharacterUi(result.state);
  });

  const switchHint =
    state.party.length > 1 ? " Left/Right to switch member." : "";

  const statLine = statRows
    .map((row) =>
      row.bonus !== 0
        ? `${row.label} ${row.base}${row.bonus >= 0 ? "+" : ""}${row.bonus}=${row.total}`
        : `${row.label} ${row.base}`,
    )
    .join("  ");

  const skillLine =
    skills.length === 0
      ? "(no skills known)"
      : skills.map((skill) => `${skill.name} (MP ${skill.mpCost})`).join(", ");

  return (
    <Screen
      state={state}
      title="Character Sheet"
      hint={`Esc to close.${switchHint}`}
    >
      <Box flexDirection="column">
        <Text>
          {member.name} - {cls?.name ?? member.classId} - Level {member.level} -
          XP {member.xp}/{xpToNext(member.level)}
        </Text>
        <Text>{statLine}</Text>
        <Text>
          ATK {atkFrom(member)} DEF {defFrom(member)} SPD {spdFrom(member)}
        </Text>
        {EQUIP_SLOTS.map((slotEntry) => {
          const item = member.equipment[slotEntry.slot];
          return (
            <Text
              color={item ? theme.rarity[item.rarity] : theme.textFaint}
              key={slotEntry.slot}
            >
              {slotEntry.label}: {item ? describeItem(item) : "(empty)"}
            </Text>
          );
        })}
        <Text>Skills: {skillLine}</Text>
        <Text color={theme.textMuted}>
          Unspent skill points: 0 (unlocks with skill trees)
        </Text>
      </Box>
    </Screen>
  );
}
