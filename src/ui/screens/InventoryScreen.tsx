import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { findShopItem } from "../../data/shops";
import { atkFrom, defFrom, spdFrom } from "../../engine/combat/resolution";
import type { InventoryItem } from "../../engine/entities/party";
import { isHealItem } from "../../engine/loot/consumables";
import { compareItem, equipTargetSlot } from "../../engine/loot/equipment";
import {
  describeItem,
  itemAffixLines,
  itemSellPrice,
  itemStatLine,
} from "../../engine/loot/items";
import type { LootFilterRules } from "../../engine/loot/lootFilter";
import type { ItemInstance, Rarity } from "../../engine/loot/types";
import type { GameEvent, GameState } from "../../engine/state/types";
import { Screen } from "../components/Screen";
import { normalizeInkKey } from "../hooks/normalizeInkKey";
import { theme } from "../theme";
import {
  ALL_STATS,
  FILTER_ROW_COUNT,
  INITIAL_INVENTORY_UI_STATE,
  type InventorySection,
  type InventoryUiState,
  reduceInventoryUi,
  resolveInventoryIntent,
  type SortKey,
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
  filter: "Loot Filter",
};

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
  const consumableIndex = Math.min(
    inventoryUi.consumableCursor,
    state.inventory.length - 1,
  );

  useInput((input, key) => {
    const keyName = normalizeInkKey(input, key);
    if (!keyName) return;
    const intent = resolveInventoryIntent(inventoryUi.section, keyName);
    if (!intent) return;

    const result = reduceInventoryUi(inventoryUi, intent, {
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
      case "useItem":
        dispatch({
          type: "UseFieldItem",
          itemId: result.effect.itemId,
          memberId: result.effect.memberId,
        });
        break;
      case "setLootFilter":
        dispatch({
          type: "SetLootFilter",
          rules: result.effect.rules,
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
      : inventoryUi.section === "consumables"
        ? `Up/down to select, u to use on target, Tab for next section, Esc to close.${switchHint}`
        : inventoryUi.section === "filter"
          ? "Up/down to select a rule, Enter/Left/Right to change value, Tab for next section, Esc to close."
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
          <ConsumablesSection
            entries={state.inventory}
            cursor={consumableIndex}
            member={member}
          />
        )}
        {inventoryUi.section === "currency" && (
          <CurrencySection gold={state.gold} />
        )}
        {inventoryUi.section === "quest" && <QuestSection />}
        {inventoryUi.section === "filter" && (
          <FilterSettingsSection
            rules={state.lootFilter}
            cursor={inventoryUi.filterCursor}
          />
        )}
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
  sortKey: SortKey;
}

function GearSection({
  entries,
  cursor,
  member,
  selected,
  inspecting,
  sortKey,
}: GearSectionProps) {
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
      {selected?.kind === "backpack" ? (
        <ComparePanel member={member} item={selected.item} />
      ) : (
        <Text color={theme.textMuted}>
          Select a backpack item to compare against its slot.
        </Text>
      )}
      {inspecting && inspectedItem && <InspectPanel item={inspectedItem} />}
    </Box>
  );
}

interface ComparePanelProps {
  member: GameState["party"][number];
  item: ItemInstance;
}

function ComparePanel({ member, item }: ComparePanelProps) {
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
          <Text color={theme.textMuted}>In backpack</Text>
          <Text color={theme.rarity[item.rarity]}>{describeItem(item)}</Text>
          <Text color={theme.text}>{itemStatLine(item)}</Text>
        </Box>
      </Box>
      <Text color={theme.gold}>Delta: {deltaLine(delta)}</Text>
    </Box>
  );
}

interface InspectPanelProps {
  item: ItemInstance;
}

function InspectPanel({ item }: InspectPanelProps) {
  const lines = itemAffixLines(item);
  return (
    <Box flexDirection="column">
      <Text color={theme.accent}>Affixes:</Text>
      {lines.length === 0 ? (
        <Text color={theme.textMuted}>(no affixes)</Text>
      ) : (
        lines.map((line) => (
          <Text color={theme.text} key={line}>
            {line}
          </Text>
        ))
      )}
    </Box>
  );
}

interface ConsumablesSectionProps {
  entries: readonly InventoryItem[];
  cursor: number;
  member: GameState["party"][number];
}

function ConsumablesSection({
  entries,
  cursor,
  member,
}: ConsumablesSectionProps) {
  if (entries.length === 0) {
    return <Text color={theme.textMuted}>(no consumables)</Text>;
  }
  return (
    <Box flexDirection="column">
      <Text>
        Target: {member.name} ({member.hp}/{member.maxHp} HP)
      </Text>
      {entries.map((entry, index) => {
        const def = findShopItem(entry.itemId);
        const selectedRow = index === cursor;
        const usable = isHealItem(entry.itemId);
        return (
          <Text
            color={selectedRow ? theme.accent : theme.text}
            key={entry.itemId}
          >
            {selectedRow ? "> " : "  "}
            {def?.name ?? entry.itemId} x{entry.quantity}
            {usable ? " [u to use]" : ""}
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

function QuestSection() {
  return <Text color={theme.textMuted}>(no quest items yet)</Text>;
}

interface FilterSettingsSectionProps {
  rules: LootFilterRules;
  cursor: number;
}

function FilterSettingsSection({ rules, cursor }: FilterSettingsSectionProps) {
  const rarityDisplay = (rarity: Rarity | undefined): string =>
    rarity ?? "none";

  return (
    <Box flexDirection="column">
      <Text>Minimum Rarity by Tier</Text>
      <FilterRow
        label="Tier 1"
        value={rarityDisplay(rules.minRarityByTier[1])}
        active={cursor === 0}
      />
      <FilterRow
        label="Tier 2"
        value={rarityDisplay(rules.minRarityByTier[2])}
        active={cursor === 1}
      />
      <FilterRow
        label="Tier 3+"
        value={rarityDisplay(rules.minRarityByTier[3])}
        active={cursor === 2}
      />

      <Text>Item Level Offset</Text>
      <FilterRow
        label="Min ilvl vs party"
        value={
          rules.minIlvlOffset !== undefined
            ? `${rules.minIlvlOffset >= 0 ? "+" : ""}${rules.minIlvlOffset}`
            : "none"
        }
        active={cursor === 3}
      />

      <Text>Keep Affix Types</Text>
      {ALL_STATS.map((stat, index) => {
        const row = index + 4;
        const enabled = rules.keepAffixStats.includes(stat);
        return (
          <FilterRow
            key={stat}
            label={stat}
            value={enabled ? "yes" : "no"}
            active={cursor === row}
          />
        );
      })}

      <Box marginTop={1}>
        <Text color={theme.textMuted}>
          Row {cursor + 1}/{FILTER_ROW_COUNT} - Enter/Left/Right changes value
        </Text>
      </Box>
    </Box>
  );
}

interface FilterRowProps {
  label: string;
  value: string;
  active: boolean;
}

function FilterRow({ label, value, active }: FilterRowProps) {
  return (
    <Box flexDirection="row">
      <Text color={active ? theme.accent : theme.text}>
        {active ? "> " : "  "}
        {label}: {value}
      </Text>
    </Box>
  );
}
