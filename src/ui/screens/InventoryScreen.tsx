import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { compareItem, equipTargetSlot } from "../../engine/loot/equipment";
import {
  describeAffixes,
  describeItem,
  itemStatLine,
} from "../../engine/loot/items";
import type { GameEvent, GameState } from "../../engine/state/types";
import { Screen } from "../components/Screen";
import { normalizeInkKey } from "../hooks/normalizeInkKey";
import { theme } from "../theme";
import {
  FILTER_ROWS,
  filterRowLabel,
  INITIAL_INVENTORY_UI_STATE,
  type InventoryUiState,
  reduceInventoryUi,
  resolveInventoryIntent,
  sortBackpackItems,
} from "./inventory/interaction";
import {
  buildPackEntries,
  EQUIP_SLOTS,
  type PackEntry,
} from "./village/interaction";

export interface InventoryScreenProps {
  state: GameState;
  dispatch: (event: GameEvent) => void;
  onClose: () => void;
}

const STAT_KEYS = ["str", "agi", "vit", "int"] as const;

function deltaLine(delta: {
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

const MODE_LABEL: Record<InventoryUiState["mode"], string> = {
  gear: "Gear",
  consumables: "Consumables",
  currency: "Currency",
  filter: "Loot Filter",
};

/**
 * Inventory screen (ENG-2): a global-hotkey overlay (`v`, see `app.tsx` and
 * `globalInput.ts`) usable from the village, overworld, and dungeon scenes -
 * battle keeps its own item flow. Four Tab-cycled panes: `gear` (equip,
 * unequip, sort, and full-affix inspect - reusing `village/interaction.ts`'s
 * pack helpers), `consumables` (use a heal item on a party member outside
 * battle), `currency` (gold, read-only), and `filter` (the loot filter's
 * settings pane). The mode/cursor state machine lives in the pure
 * `reduceInventoryUi`; this component only normalizes Ink's input, resolves
 * an intent, applies the result, and dispatches the mapped event.
 */
export function InventoryScreen({
  state,
  dispatch,
  onClose,
}: InventoryScreenProps) {
  const [ui, setUi] = useState<InventoryUiState>(INITIAL_INVENTORY_UI_STATE);

  const clampedMemberIndex = Math.min(ui.memberIndex, state.party.length - 1);
  const member = state.party[clampedMemberIndex];
  const sortedItems = sortBackpackItems(state.items, ui.gearSort);
  const packEntries = buildPackEntries(member, sortedItems);

  useInput((input, key) => {
    const keyName = normalizeInkKey(input, key);
    if (!keyName) return;
    const intent = resolveInventoryIntent(ui.mode, keyName);
    if (!intent) return;

    const result = reduceInventoryUi(ui, intent, {
      partyLength: state.party.length,
      memberId: member.id,
      packEntries,
      consumables: state.inventory,
      lootFilter: state.lootFilter,
    });

    switch (result.effect?.type) {
      case "equip":
        dispatch({
          type: "EquipItem",
          instanceId: result.effect.instanceId,
          memberId: result.effect.memberId,
        });
        break;
      case "unequip":
        dispatch({
          type: "UnequipItem",
          slot: result.effect.slot,
          memberId: result.effect.memberId,
        });
        break;
      case "useFieldItem":
        dispatch({
          type: "UseFieldItem",
          itemId: result.effect.itemId,
          memberId: result.effect.memberId,
        });
        break;
      case "setLootFilter":
        dispatch({ type: "SetLootFilter", filter: result.effect.filter });
        break;
      case "close":
        onClose();
        break;
      default:
        break;
    }

    setUi(result.state);
  });

  const switchHint =
    state.party.length > 1 ? " Left/Right to switch member." : "";
  const hint =
    ui.mode === "gear"
      ? `Up/down to select, e to equip, u to unequip, r to cycle sort, Enter to inspect, Tab for consumables, Esc to go back.${switchHint}`
      : ui.mode === "consumables"
        ? `Up/down to select, u to use on ${member.name}, Tab for currency, Esc to go back.${switchHint}`
        : ui.mode === "currency"
          ? "Tab for the loot filter, Esc to go back."
          : "Up/down to select a row, Enter/Left/Right to edit, Tab for gear, Esc to go back.";

  return (
    <Screen
      state={state}
      title={`Inventory - ${MODE_LABEL[ui.mode]}`}
      hint={hint}
    >
      <Box flexDirection="column" gap={1}>
        {ui.mode === "gear" && (
          <GearPane
            entries={packEntries}
            cursor={Math.min(ui.gearCursor, packEntries.length - 1)}
            inspecting={ui.inspecting}
            member={member}
            sort={ui.gearSort}
          />
        )}
        {ui.mode === "consumables" && (
          <ConsumablesPane
            consumables={state.inventory}
            cursor={Math.min(ui.consumableCursor, state.inventory.length - 1)}
            memberName={member.name}
          />
        )}
        {ui.mode === "currency" && <CurrencyPane gold={state.gold} />}
        {ui.mode === "filter" && (
          <FilterPane cursor={ui.filterCursor} filter={state.lootFilter} />
        )}
      </Box>
    </Screen>
  );
}

interface GearPaneProps {
  entries: readonly PackEntry[];
  cursor: number;
  inspecting: boolean;
  member: GameState["party"][number];
  sort: string;
}

function GearPane({
  entries,
  cursor,
  inspecting,
  member,
  sort,
}: GearPaneProps) {
  const selected = entries[cursor];
  let compare: string | null = null;
  let affixLines: string[] = [];
  if (selected?.kind === "backpack") {
    const target = equipTargetSlot(member, selected.item);
    const targetLabel =
      EQUIP_SLOTS.find((e) => e.slot === target)?.label ?? "?";
    compare = `Equipping into ${targetLabel}: ${deltaLine(compareItem(member, selected.item))}`;
    affixLines = describeAffixes(selected.item);
  } else if (selected?.kind === "equipped" && selected.item) {
    affixLines = describeAffixes(selected.item);
  }

  return (
    <Box flexDirection="column">
      <Text color={theme.textMuted}>Sort: {sort}</Text>
      {entries.map((entry, index) => {
        const selectedRow = index === cursor;
        if (entry.kind === "equipped") {
          const text = entry.item
            ? `${entry.label}: ${describeItem(entry.item)} (${itemStatLine(entry.item)})`
            : `${entry.label}: (empty)`;
          return (
            <Text
              color={
                selectedRow
                  ? theme.accent
                  : entry.item
                    ? theme.rarity[entry.item.rarity]
                    : theme.textFaint
              }
              key={entry.slot}
            >
              {selectedRow ? "> " : "  "}
              {text}
              {entry.item ? " [u to unequip]" : ""}
            </Text>
          );
        }
        return (
          <Text
            color={selectedRow ? theme.accent : theme.rarity[entry.item.rarity]}
            key={entry.item.instanceId}
          >
            {selectedRow ? "> " : "  "}
            {describeItem(entry.item)} - {itemStatLine(entry.item)} [e equip]
          </Text>
        );
      })}
      {inspecting && affixLines.length > 0 ? (
        <Box flexDirection="column">
          <Text color={theme.accent}>Affixes:</Text>
          {affixLines.map((line) => (
            <Text color={theme.textMuted} key={line}>
              {line}
            </Text>
          ))}
        </Box>
      ) : compare ? (
        <Text color={theme.gold}>{compare}</Text>
      ) : (
        <Text color={theme.textMuted}>
          Select an item and press Enter to inspect its affixes.
        </Text>
      )}
    </Box>
  );
}

interface ConsumablesPaneProps {
  consumables: GameState["inventory"];
  cursor: number;
  memberName: string;
}

function ConsumablesPane({
  consumables,
  cursor,
  memberName,
}: ConsumablesPaneProps) {
  if (consumables.length === 0) {
    return <Text color={theme.textMuted}>(no consumables carried)</Text>;
  }
  return (
    <Box flexDirection="column">
      {consumables.map((entry, index) => (
        <Text
          color={index === cursor ? theme.accent : undefined}
          key={entry.itemId}
        >
          {index === cursor ? "> " : "  "}
          {entry.itemId} x{entry.quantity} [u to use on {memberName}]
        </Text>
      ))}
    </Box>
  );
}

function CurrencyPane({ gold }: { gold: number }) {
  return <Text color={theme.gold}>Gold: {gold}</Text>;
}

interface FilterPaneProps {
  cursor: number;
  filter: GameState["lootFilter"];
}

function FilterPane({ cursor, filter }: FilterPaneProps) {
  const rows: string[] = [
    `Enabled: ${filter.enabled ? "yes" : "no"}`,
    `Min rarity to keep: ${filter.minRarity}`,
    `Min ilvl offset: ${filter.minIlvlOffset}`,
    ...(["str", "agi", "vit", "int"] as const).map(
      (stat) =>
        `Always keep ${stat.toUpperCase()} affixes: ${filter.keepAffixStats.includes(stat) ? "yes" : "no"}`,
    ),
  ];
  return (
    <Box flexDirection="column">
      <Text color={theme.textMuted}>
        Auto-dismantles a drop only when it fails the rarity bar AND the ilvl
        bar AND carries none of your kept affix stats.
      </Text>
      {rows.map((row, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed-size row list, position is identity
        <Text color={index === cursor ? theme.accent : undefined} key={index}>
          {index === cursor ? "> " : "  "}
          {row}
        </Text>
      ))}
      <Text color={theme.textMuted}>
        {filterRowLabel(cursor)} (row {cursor + 1}/{FILTER_ROWS})
      </Text>
    </Box>
  );
}
