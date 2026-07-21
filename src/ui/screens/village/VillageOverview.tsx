import { Text, useInput } from "ink";
import { useState } from "react";
import type { GameState } from "../../../engine/state/types";
import { Screen } from "../../components/Screen";
import { theme } from "../../theme";
import type { VillageBuilding } from "./types";

/** A selectable row on the overview: a building sub-view, or leaving to the overworld. */
interface MenuOption {
  key: VillageBuilding | "overworld";
  label: string;
  shortcut: string;
}

const OPTIONS: readonly MenuOption[] = [
  { key: "inn", label: "Inn - rest and heal the party", shortcut: "i" },
  { key: "church", label: "Church - save your progress", shortcut: "c" },
  { key: "store", label: "Store - buy and sell items", shortcut: "s" },
  { key: "tavern", label: "Tavern - recruit party members", shortcut: "t" },
  {
    key: "overworld",
    label: "Leave town - venture into the overworld",
    shortcut: "o",
  },
];

export interface VillageOverviewProps {
  state: GameState;
  onEnter: (building: VillageBuilding) => void;
  onLeave: () => void;
}

/** Village hub landing view: party/gold summary plus a building/overworld picker. */
export function VillageOverview({
  state,
  onEnter,
  onLeave,
}: VillageOverviewProps) {
  const [cursor, setCursor] = useState(0);

  const choose = (option: MenuOption) => {
    if (option.key === "overworld") onLeave();
    else onEnter(option.key);
  };

  useInput((input, key) => {
    if (key.upArrow) {
      setCursor((current) => (current + OPTIONS.length - 1) % OPTIONS.length);
      return;
    }
    if (key.downArrow) {
      setCursor((current) => (current + 1) % OPTIONS.length);
      return;
    }
    if (key.return) {
      choose(OPTIONS[cursor]);
      return;
    }
    const shortcut = OPTIONS.find((option) => option.shortcut === input);
    if (shortcut) choose(shortcut);
  });

  return (
    <Screen
      state={state}
      title="Village"
      hint="Controls: up/down + Enter, or i/c/s/t/o to act directly; 1-4 switch scenes; q to quit."
    >
      {OPTIONS.map((option, index) => (
        <Text
          color={index === cursor ? theme.accent : undefined}
          key={option.key}
        >
          {index === cursor ? "> " : "  "}[{option.shortcut}] {option.label}
        </Text>
      ))}
    </Screen>
  );
}
