import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { SHOP_ITEMS, sellPriceFor } from "../../../data/shops";
import { describeItem, itemSellPrice } from "../../../engine/loot/items";
import type { GameEvent, GameState } from "../../../engine/state/types";
import { Screen } from "../../components/Screen";
import { normalizeInkKey } from "../../hooks/normalizeInkKey";
import { theme } from "../../theme";
import {
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

/**
 * Store sub-view (PROJECT_PLAN Phase 5, ROG-11; multi-member switcher in
 * ROG-20; slimmed to buy/sell in ENG-2). Two modes: `shop` browses the
 * static catalog and buys/sells stackable consumables one unit at a time;
 * `pack` sells generated loot for its rarity/affix-scaled price. Equip,
 * unequip, compare, and inspect moved to the dedicated Inventory screen
 * (ENG-2, `v` key) once it became the canonical place to manage gear - this
 * view only needs to move gold, so it no longer shows equipment slots or a
 * compare panel. Tab switches modes; Esc returns to the village overview.
 * The mode/cursor state machine lives in the pure `reduceStoreUi` (ROG-45);
 * this component only normalizes Ink's input, resolves an intent, applies
 * the result, and dispatches the mapped event.
 */
export function StoreView({ state, dispatch, onBack }: StoreViewProps) {
  const [storeUi, setStoreUi] = useState<StoreUiState>(INITIAL_STORE_UI_STATE);

  const packEntries: PackEntry[] = state.items.map((item) => ({
    kind: "backpack" as const,
    item,
  }));
  const packIndex = Math.min(storeUi.packCursor, packEntries.length - 1);

  useInput((input, key) => {
    const keyName = normalizeInkKey(input, key);
    if (!keyName) return;
    const intent = resolveStoreIntent(storeUi.mode, keyName);
    if (!intent) return;

    const result = reduceStoreUi(storeUi, intent, {
      partyLength: state.party.length,
      memberId: state.party[0]?.id ?? "",
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

  return (
    <Screen
      state={state}
      title={`Store - ${storeUi.mode === "shop" ? "Shop" : "Backpack"}`}
      hint={
        storeUi.mode === "shop"
          ? "Up/down to select, b to buy 1, s to sell 1, Tab for backpack, Esc to go back."
          : "Up/down to select, s to sell, Tab for shop, Esc to go back. (Equip/unequip moved to the Inventory screen - press v.)"
      }
    >
      <Box flexDirection="column" gap={1}>
        {storeUi.mode === "shop" ? (
          <ShopCatalog cursor={storeUi.shopCursor} state={state} />
        ) : (
          <BackpackSellList cursor={packIndex} entries={packEntries} />
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

interface BackpackSellListProps {
  entries: readonly PackEntry[];
  cursor: number;
}

/** Sell-only backpack list (ENG-2): equip/compare now live on the Inventory screen. */
function BackpackSellList({ entries, cursor }: BackpackSellListProps) {
  if (entries.length === 0) {
    return <Text color={theme.textMuted}>(backpack is empty)</Text>;
  }
  return (
    <Box flexDirection="column">
      {entries.map((entry, index) => {
        if (entry.kind !== "backpack") return null;
        const selectedRow = index === cursor;
        return (
          <Text
            color={selectedRow ? theme.accent : theme.rarity[entry.item.rarity]}
            key={entry.item.instanceId}
          >
            {selectedRow ? "> " : "  "}
            {describeItem(entry.item)} - sell {itemSellPrice(entry.item)}g [s to
            sell]
          </Text>
        );
      })}
    </Box>
  );
}
