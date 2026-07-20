import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { SHOP_ITEMS, sellPriceFor } from "../../../data/shops";
import { atkFrom, defFrom, spdFrom } from "../../../engine/combat/resolution";
import {
  compareItem,
  type EquipmentSlotName,
  equipTargetSlot,
} from "../../../engine/loot/equipment";
import {
  describeItem,
  itemSellPrice,
  itemStatLine,
} from "../../../engine/loot/items";
import type { ItemInstance } from "../../../engine/loot/types";
import type { GameEvent, GameState } from "../../../engine/state/types";
import { MessageLog } from "../../components/MessageLog";

export interface StoreViewProps {
  state: GameState;
  dispatch: (event: GameEvent) => void;
  onBack: () => void;
}

type StoreMode = "shop" | "pack";

const EQUIP_SLOTS: readonly { slot: EquipmentSlotName; label: string }[] = [
  { slot: "weapon", label: "Weapon" },
  { slot: "armor", label: "Armor" },
  { slot: "accessory1", label: "Accessory 1" },
  { slot: "accessory2", label: "Accessory 2" },
];

type PackEntry =
  | {
      kind: "equipped";
      slot: EquipmentSlotName;
      label: string;
      item: ItemInstance | null;
    }
  | { kind: "backpack"; item: ItemInstance };

const STAT_KEYS = ["str", "agi", "vit", "int"] as const;

/** Compact signed stat delta line for the compare panel. */
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

/**
 * Store sub-view (PROJECT_PLAN Phase 5, ROG-11). Two modes: `shop` browses the
 * static catalog and buys/sells stackable consumables one unit at a time; `pack`
 * manages generated, affix-bearing loot - equip, unequip, compare against the
 * slot it would fill, and sell for a rarity/affix-scaled price. Tab switches
 * modes; Esc returns to the village overview.
 */
export function StoreView({ state, dispatch, onBack }: StoreViewProps) {
  const [mode, setMode] = useState<StoreMode>("shop");
  const [shopCursor, setShopCursor] = useState(0);
  const [packCursor, setPackCursor] = useState(0);

  const hero = state.party[0];

  const packEntries: PackEntry[] = [
    ...EQUIP_SLOTS.map((entry) => ({
      kind: "equipped" as const,
      slot: entry.slot,
      label: entry.label,
      item: hero.equipment[entry.slot],
    })),
    ...state.items.map((item) => ({ kind: "backpack" as const, item })),
  ];
  const packIndex = Math.min(packCursor, packEntries.length - 1);
  const selectedPack = packEntries[packIndex];

  useInput((input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (key.tab) {
      setMode((current) => (current === "shop" ? "pack" : "shop"));
      setShopCursor(0);
      setPackCursor(0);
      return;
    }

    if (mode === "shop") {
      if (key.upArrow) {
        setShopCursor((c) => (c + SHOP_ITEMS.length - 1) % SHOP_ITEMS.length);
        return;
      }
      if (key.downArrow) {
        setShopCursor((c) => (c + 1) % SHOP_ITEMS.length);
        return;
      }
      const selected = SHOP_ITEMS[shopCursor];
      if (!selected) return;
      if (input === "b") {
        dispatch({ type: "StoreBuy", itemId: selected.id, quantity: 1 });
        return;
      }
      if (input === "s") {
        dispatch({ type: "StoreSell", itemId: selected.id, quantity: 1 });
      }
      return;
    }

    // mode === "pack"
    if (key.upArrow) {
      setPackCursor((c) => (c + packEntries.length - 1) % packEntries.length);
      return;
    }
    if (key.downArrow) {
      setPackCursor((c) => (c + 1) % packEntries.length);
      return;
    }
    if (!selectedPack) return;
    if (selectedPack.kind === "backpack") {
      if (input === "e") {
        dispatch({
          type: "EquipItem",
          instanceId: selectedPack.item.instanceId,
        });
        return;
      }
      if (input === "s") {
        dispatch({
          type: "SellItem",
          instanceId: selectedPack.item.instanceId,
        });
      }
      return;
    }
    if (input === "u") {
      dispatch({ type: "UnequipItem", slot: selectedPack.slot });
    }
  });

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Store - {mode === "shop" ? "Shop" : "Backpack"}</Text>
      <Text>
        Gold: {state.gold} | Hero ATK {atkFrom(hero)} DEF {defFrom(hero)} SPD{" "}
        {spdFrom(hero)}
      </Text>

      {mode === "shop" ? (
        <ShopCatalog cursor={shopCursor} state={state} />
      ) : (
        <BackpackPanel
          entries={packEntries}
          cursor={packIndex}
          hero={hero}
          selected={selectedPack}
        />
      )}

      <Text dimColor>
        {mode === "shop"
          ? "Up/down to select, b to buy 1, s to sell 1, Tab for backpack, Esc to go back."
          : "Up/down to select, e to equip, u to unequip, s to sell, Tab for shop, Esc to go back."}
      </Text>
      <MessageLog messages={state.log} />
    </Box>
  );
}

interface ShopCatalogProps {
  cursor: number;
  state: GameState;
}

function ShopCatalog({ cursor, state }: ShopCatalogProps) {
  return (
    <Box flexDirection="column">
      {SHOP_ITEMS.map((item, index) => {
        const owned =
          state.inventory.find((entry) => entry.itemId === item.id)?.quantity ??
          0;
        return (
          <Text color={index === cursor ? "green" : undefined} key={item.id}>
            {index === cursor ? "> " : "  "}
            {item.name} - buy {item.price}g / sell {sellPriceFor(item)}g (owned{" "}
            {owned})
          </Text>
        );
      })}
    </Box>
  );
}

interface BackpackPanelProps {
  entries: readonly PackEntry[];
  cursor: number;
  hero: GameState["party"][number];
  selected: PackEntry | undefined;
}

function BackpackPanel({
  entries,
  cursor,
  hero,
  selected,
}: BackpackPanelProps) {
  let compare: string | null = null;
  if (selected?.kind === "backpack") {
    const target = equipTargetSlot(hero, selected.item);
    const targetLabel =
      EQUIP_SLOTS.find((entry) => entry.slot === target)?.label ?? "?";
    compare = `Equipping into ${targetLabel}: ${deltaLine(compareItem(hero, selected.item))}`;
  }

  return (
    <Box flexDirection="column">
      {entries.map((entry, index) => {
        const selectedRow = index === cursor;
        if (entry.kind === "equipped") {
          const text = entry.item
            ? `${entry.label}: ${describeItem(entry.item)} (${itemStatLine(entry.item)})`
            : `${entry.label}: (empty)`;
          return (
            <Text color={selectedRow ? "green" : undefined} key={entry.slot}>
              {selectedRow ? "> " : "  "}
              {text}
              {entry.item ? " [u to unequip]" : ""}
            </Text>
          );
        }
        return (
          <Text
            color={selectedRow ? "green" : undefined}
            key={entry.item.instanceId}
          >
            {selectedRow ? "> " : "  "}
            {describeItem(entry.item)} - {itemStatLine(entry.item)} - sell{" "}
            {itemSellPrice(entry.item)}g [e equip / s sell]
          </Text>
        );
      })}
      {compare ? (
        <Text color="yellow">{compare}</Text>
      ) : (
        <Text dimColor>
          Select a backpack item to compare against its slot.
        </Text>
      )}
    </Box>
  );
}
