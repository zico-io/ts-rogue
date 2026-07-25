import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { SHOP_ITEMS, sellPriceFor } from "../../../data/shops";
import { atkFrom, defFrom, spdFrom } from "../../../engine/combat/resolution";
import {
  describeItem,
  itemSellPrice,
  itemStatLine,
} from "../../../engine/loot/items";
import type { GameEvent, GameState } from "../../../engine/state/types";
import { Screen } from "../../components/Screen";
import { normalizeInkKey } from "../../hooks/normalizeInkKey";
import { theme } from "../../theme";
import {
  buildPackEntries,
  INITIAL_STORE_UI_STATE,
  type PackEntry,
  reduceStoreUi,
  resolveStoreIntent,
  type StoreUiState,
} from "./interaction";

export interface StoreViewProps {
  state: GameState;
  dispatch: (event: GameEvent) => void;
  onBack: () => void;
}

const STAT_KEYS = ["str", "agi", "vit", "int"] as const;

/**
 * Compact signed stat delta line for a compare panel. Exported so the
 * Inventory screen (ENG-3, `screens/inventory/InventoryScreen.tsx`) reuses
 * this formatting for its own gear compare panel instead of duplicating it.
 */
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

/**
 * Store sub-view (PROJECT_PLAN Phase 5, ROG-11; multi-member switcher in
 * ROG-20). Two modes: `shop` browses the static catalog and buys/sells
 * stackable consumables one unit at a time; `pack` lists the selected party
 * member's equipment slots and backpack and sells backpack items for a
 * rarity/affix-scaled price. Tab switches modes; Left/Right cycles which
 * party member `pack` mode targets (only shown once the party has more than
 * one member); Esc returns to the village overview. The mode/cursor state
 * machine lives in the pure `reduceStoreUi` (ROG-45); this component only
 * normalizes Ink's input, resolves an intent, applies the result, and
 * dispatches the mapped event.
 *
 * ENG-3: `pack` mode used to also equip/unequip/compare gear; that moved to
 * the dedicated Inventory screen (`char:v`, `screens/inventory`), which is
 * now the canonical place to browse, inspect, and equip gear. This view's
 * `pack` mode is sell-only.
 */
export function StoreView({ state, dispatch, onBack }: StoreViewProps) {
  const [storeUi, setStoreUi] = useState<StoreUiState>(INITIAL_STORE_UI_STATE);

  const clampedMemberIndex = Math.min(
    storeUi.memberIndex,
    state.party.length - 1,
  );
  const member = state.party[clampedMemberIndex];
  const packEntries = buildPackEntries(member, state.items);
  const packIndex = Math.min(storeUi.packCursor, packEntries.length - 1);

  useInput((input, key) => {
    const keyName = normalizeInkKey(input, key);
    if (!keyName) return;
    const intent = resolveStoreIntent(storeUi.mode, keyName);
    if (!intent) return;

    const result = reduceStoreUi(storeUi, intent, {
      partyLength: state.party.length,
      memberId: member.id,
      packEntries,
    });

    switch (result.effect?.type) {
      case "storeBuy":
        dispatch({
          type: "StoreBuy",
          itemId: result.effect.itemId,
          quantity: 1,
        });
        break;
      case "storeSell":
        dispatch({
          type: "StoreSell",
          itemId: result.effect.itemId,
          quantity: 1,
        });
        break;
      case "sellItem":
        dispatch({ type: "SellItem", instanceId: result.effect.instanceId });
        break;
      case "back":
        onBack();
        break;
      default:
        break;
    }

    setStoreUi(result.state);
  });

  const switchHint =
    state.party.length > 1 ? " Left/Right to switch member." : "";

  return (
    <Screen
      state={state}
      title={`Store - ${storeUi.mode === "shop" ? "Shop" : "Backpack"}`}
      hint={
        storeUi.mode === "shop"
          ? `Up/down to select, b to buy 1, s to sell 1, Tab for backpack, Esc to go back.${switchHint}`
          : `Up/down to select, s to sell, Tab for shop, Esc to go back.${switchHint}`
      }
    >
      <Box flexDirection="column" gap={1}>
        <Text>
          {member.name} ATK {atkFrom(member)} DEF {defFrom(member)} SPD{" "}
          {spdFrom(member)}
        </Text>

        {storeUi.mode === "shop" ? (
          <ShopCatalog cursor={storeUi.shopCursor} state={state} />
        ) : (
          <BackpackPanel entries={packEntries} cursor={packIndex} />
        )}
      </Box>
    </Screen>
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
          <Text
            color={index === cursor ? theme.accent : undefined}
            key={item.id}
          >
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
}

/**
 * Sell-only backpack listing (ENG-3): equipment slots are display-only rows
 * (no unequip affordance) and backpack items only offer `[s sell]` - equip,
 * unequip, and the compare panel moved to the Inventory screen.
 */
function BackpackPanel({ entries, cursor }: BackpackPanelProps) {
  return (
    <Box flexDirection="column">
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
            {itemSellPrice(entry.item)}g [s sell]
          </Text>
        );
      })}
    </Box>
  );
}
