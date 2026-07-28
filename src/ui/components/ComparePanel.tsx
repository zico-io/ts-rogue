import { Box, Text } from "ink";
import { compareItem, equipTargetSlot } from "../../engine/loot/equipment";
import { describeItem, itemStatLine } from "../../engine/loot/items";
import type { ItemInstance } from "../../engine/loot/types";
import type { GameState } from "../../engine/state/types";
import { EQUIP_SLOTS } from "../screens/village/interaction";
import { theme } from "../theme";

const STAT_KEYS = ["str", "agi", "vit", "int"] as const;

export function deltaLine(delta: {
  str: number;
  agi: number;
  vit: number;
  int: number;
}): string {
  const parts: string[] = [];
  for (const key of STAT_KEYS) {
    if (delta[key] !== 0) {
      parts.push(
        `${delta[key] >= 0 ? "+" : ""}${delta[key]} ${key.toUpperCase()}`,
      );
    }
  }
  return parts.length === 0 ? "no stat change" : parts.join(" ");
}

export interface ComparePanelProps {
  member: GameState["party"][number];
  item: ItemInstance;
  /** Label for the right-hand column; defaults to "In backpack". */
  candidateLabel?: string;
}

/** Shared by the Inventory backpack view and the Store's rare stock (ENG-41). */
export function ComparePanel({
  member,
  item,
  candidateLabel = "In backpack",
}: ComparePanelProps) {
  const targetSlot = equipTargetSlot(member, item);
  const slotDef = EQUIP_SLOTS.find((entry) => entry.slot === targetSlot);
  const slotLabel = slotDef?.label ?? "Unknown";
  const equipped = targetSlot ? member.equipment[targetSlot] : null;
  const delta = compareItem(member, item);

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row">
        {}
        <Box flexDirection="column" marginRight={4}>
          <Text color={theme.textMuted}>Equipped ({slotLabel})</Text>
          {equipped ? (
            <>
              <Text color={theme.rarity[equipped.rarity]}>
                {describeItem(equipped)}
              </Text>
              <Text color={theme.text}>{itemStatLine(equipped)}</Text>
            </>
          ) : (
            <Text color={theme.textFaint}>(empty)</Text>
          )}
        </Box>
        {}
        <Box flexDirection="column">
          <Text color={theme.textMuted}>{candidateLabel}</Text>
          <Text color={theme.rarity[item.rarity]}>{describeItem(item)}</Text>
          <Text color={theme.text}>{itemStatLine(item)}</Text>
        </Box>
      </Box>
      <Text color={theme.gold}>Delta: {deltaLine(delta)}</Text>
    </Box>
  );
}
