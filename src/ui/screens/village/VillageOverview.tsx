import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { GameState } from "../../../engine/state/types";
import { MessageLog } from "../../components/MessageLog";
import type { VillageBuilding } from "./types";

interface BuildingOption {
  key: VillageBuilding;
  label: string;
  shortcut: string;
}

const BUILDINGS: readonly BuildingOption[] = [
  { key: "inn", label: "Inn - rest and heal the party", shortcut: "i" },
  { key: "church", label: "Church - save your progress", shortcut: "c" },
  { key: "store", label: "Store - buy and sell items", shortcut: "s" },
];

export interface VillageOverviewProps {
  state: GameState;
  onEnter: (building: VillageBuilding) => void;
}

/** Village hub landing view: party/gold summary plus a building picker. */
export function VillageOverview({ state, onEnter }: VillageOverviewProps) {
  const [cursor, setCursor] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setCursor(
        (current) => (current + BUILDINGS.length - 1) % BUILDINGS.length,
      );
      return;
    }
    if (key.downArrow) {
      setCursor((current) => (current + 1) % BUILDINGS.length);
      return;
    }
    if (key.return) {
      onEnter(BUILDINGS[cursor].key);
      return;
    }
    const shortcut = BUILDINGS.find((building) => building.shortcut === input);
    if (shortcut) onEnter(shortcut.key);
  });

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Village</Text>
      <Box flexDirection="column">
        {state.party.map((member) => (
          <Text key={member.id}>
            {member.name} - HP {member.hp}/{member.maxHp} MP {member.mp}/
            {member.maxMp}
          </Text>
        ))}
        <Text>Gold: {state.gold}</Text>
      </Box>
      <Box flexDirection="column">
        {BUILDINGS.map((building, index) => (
          <Text
            color={index === cursor ? "green" : undefined}
            key={building.key}
          >
            {index === cursor ? "> " : "  "}[{building.shortcut}]{" "}
            {building.label}
          </Text>
        ))}
      </Box>
      <Text dimColor>
        Controls: up/down + Enter, or i/c/s to enter a building directly; 1-4
        switch scenes; q to quit.
      </Text>
      <MessageLog messages={state.log} />
    </Box>
  );
}
