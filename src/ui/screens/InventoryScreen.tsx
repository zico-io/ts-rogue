import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { findShopItem } from "../../data/shops";
import { atkFrom, defFrom, spdFrom } from "../../engine/combat/resolution";
import { compareItem, equipTargetSlot } from "../../engine/loot/equipment";
import {
  describeItem,
  itemAffixLines,
  itemSellPrice,
  itemStatLine,
} from "../../engine/loot/items";
import type { GameEvent, GameState } from "../../engine/state/types";
import { Screen } from "../components/Screen";
import { normalizeInkKey } from "../hooks/normalizeInkKey";
import { theme } from "../theme";
import {
  INITIAL_INVENTORY_UI_STATE,
  type InventorySection,
  type InventoryUiState,
  reduceInventoryUi,
  resolveInventoryIntent,
  sortPackEntries,
} from "./inventory/interaction";
import {
  buildPackEntries,
  EQUIP_SLOTS,
  type PackEntry,
} from "./village/interaction";
import { deltaLine } from "./village/StoreView";

export interface InventoryScreenProps {
  state: GameState;
  dispatch: (event: GameEvent) => void;
  onClose: () => void;
}

const SECTION_LABEL: Record<InventorySection, string> = {
  gear: "Gear",
  consumables: "Consumables",
  currency: "Currency",
  quest: "Quest Items",
};

/**
 * The dedicated Inventory screen (ENG-3, workstream 1 of the ENG-2
 * inventory-system epic): the canonical place to browse gear, consumables,
 * currency, and (eventually) quest items, and to inspect/compare/equip gear
 * for any party member. Opened from anywhere outside battle via `char:v`
 * (see `app.tsx`'s `inventoryOpen` state, mirroring `ZoomScreen`'s overlay
 * pattern). Tab cycles the four sections; the gear section reuses
 * `village/interaction.ts`'s pack-row/compare building blocks (also used by
 * `StoreView`, which is now sell-only) rather than duplicating them. The
 * section/sort/inspect/member-index state machine lives in the pure
 * `reduceInventoryUi`; this component only normalizes Ink's input, resolves
 * an intent, applies the result, and dispatches the mapped event.
 */
export function InventoryScreen({
  state,
  dispatch,
  onClose,
}: InventoryScreenProps) {
  const [inventoryUi, setInventoryUi] = useState<InventoryUiState>(
    INITIAL_INVENTORY_UI_STATE,
  );

  const clampedMemberIndex = Math.min(
    inventoryUi.memberIndex,
    state.party.length - 1,
  );
  const member = state.party[clampedMemberIndex];
  const packEntries = sortPackEntries(
    buildPackEntries(member, state.items),
    inventoryUi.sortKey,
  );
  const packIndex = Math.min(inventoryUi.packCursor, packEntries.length - 1);
  const selectedPack = packEntries[packIndex];

  useInput((input, key) => {
    const keyName = normalizeInkKey(input, key);
    if (!keyName) return;
    const intent = resolveInventoryIntent(inventoryUi.section, keyName);
    if (!intent) return;

    const result = reduceInventoryUi(inventoryUi, intent, {
      partyLength: state.party.length,
      memberId: member.id,
      packEntries,
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
      case "back":
        onClose();
        break;
      default:
        break;
    }

    setInventoryUi(result.state);
  });

  const switchHint =
    state.party.length > 1 ? " Left/Right to switch member." : "";
  const hint =
    inventoryUi.section === "gear"
      ? `Up/down to select, Enter to inspect, e to equip, u to unequip, r to cycle sort (${inventoryUi.sortKey}), Tab for next section, Esc to close.${switchHint}`
      : "Tab for next section, Esc to close.";

  return (
    <Screen
      state={state}
      title={`Inventory - ${SECTION_LABEL[inventoryUi.section]}`}
      hint={hint}
    >
      <Box flexDirection="column" gap={1}>
        {inventoryUi.section === "gear" && (
          <GearSection
            entries={packEntries}
            cursor={packIndex}
            member={member}
            selected={selectedPack}
            inspecting={inventoryUi.inspecting}
            sortKey={inventoryUi.sortKey}
          />
        )}
        {inventoryUi.section === "consumables" && (
          <ConsumablesSection state={state} />
        )}
        {inventoryUi.section === "currency" && (
          <CurrencySection gold={state.gold} />
        )}
        {inventoryUi.section === "quest" && <QuestSection />}
      </Box>
    </Screen>
  );
}

interface GearSectionProps {
  entries: readonly PackEntry[];
  cursor: number;
  member: GameState["party"][number];
  selected: PackEntry | undefined;
  inspecting: boolean;
  sortKey: string;
}

function GearSection({
  entries,
  cursor,
  member,
  selected,
  inspecting,
  sortKey,
}: GearSectionProps) {
  let compare: string | null = null;
  if (selected?.kind === "backpack") {
    const target = equipTargetSlot(member, selected.item);
    const targetLabel =
      EQUIP_SLOTS.find((entry) => entry.slot === target)?.label ?? "?";
    compare = `Equipping into ${targetLabel}: ${deltaLine(compareItem(member, selected.item))}`;
  }

  const inspectedItem =
    selected?.kind === "backpack"
      ? selected.item
      : selected?.kind === "equipped"
        ? selected.item
        : null;

  return (
    <Box flexDirection="column">
      <Text>
        {member.name} ATK {atkFrom(member)} DEF {defFrom(member)} SPD{" "}
        {spdFrom(member)} - sort: {sortKey} (r to cycle)
      </Text>
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
            {describeItem(entry.item)} - {itemStatLine(entry.item)} - sell{" "}
            {itemSellPrice(entry.item)}g [e equip]
          </Text>
        );
      })}
      {compare ? (
        <Text color={theme.gold}>{compare}</Text>
      ) : (
        <Text color={theme.textMuted}>
          Select a backpack item to compare against its slot.
        </Text>
      )}
      {inspecting && inspectedItem && (
        <Box flexDirection="column">
          <Text color={theme.accent}>Affixes:</Text>
          {itemAffixLines(inspectedItem).length === 0 ? (
            <Text color={theme.textMuted}>(no affixes)</Text>
          ) : (
            itemAffixLines(inspectedItem).map((line) => (
              <Text color={theme.text} key={line}>
                {line}
              </Text>
            ))
          )}
        </Box>
      )}
    </Box>
  );
}

interface ConsumablesSectionProps {
  state: GameState;
}

/** Read-only browse of owned consumable stacks; using them is a future workstream (ENG-4). */
function ConsumablesSection({ state }: ConsumablesSectionProps) {
  if (state.inventory.length === 0) {
    return <Text color={theme.textMuted}>(no consumables)</Text>;
  }
  return (
    <Box flexDirection="column">
      {state.inventory.map((entry) => {
        const def = findShopItem(entry.itemId);
        return (
          <Text key={entry.itemId}>
            {def?.name ?? entry.itemId} x{entry.quantity}
          </Text>
        );
      })}
    </Box>
  );
}

interface CurrencySectionProps {
  gold: number;
}

function CurrencySection({ gold }: CurrencySectionProps) {
  return <Text color={theme.gold}>Gold: {gold}</Text>;
}

/** Quest items have no backing data model yet - explicit empty state, not a crash. */
function QuestSection() {
  return <Text color={theme.textMuted}>(no quest items yet)</Text>;
}
