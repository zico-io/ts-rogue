import { Box, Text, useInput } from "ink";
import { useEffect, useState } from "react";
import {
  isGearShopItem,
  nextLockedTier,
  sellPriceFor,
} from "../../../data/shops";
import { atkFrom, defFrom, spdFrom } from "../../../engine/combat/resolution";
import {
  describeItem,
  itemSellPrice,
  itemStatLine,
  rolledItemPrice,
} from "../../../engine/loot/items";
import type { GameEvent, GameState } from "../../../engine/state/types";
import { ComparePanel } from "../../components/ComparePanel";
import { Screen } from "../../components/Screen";
import { normalizeInkKey } from "../../hooks/normalizeInkKey";
import { theme } from "../../theme";
import {
  buildPackEntries,
  buildShopRows,
  INITIAL_STORE_UI_STATE,
  type PackEntry,
  reduceStoreUi,
  resolveStoreIntent,
  type ShopRow,
  type StoreUiState,
} from "./interaction";

export interface StoreViewProps {
  state: GameState;
  dispatch: (event: GameEvent) => void;
  onBack: () => void;
}

export function StoreView({ state, dispatch, onBack }: StoreViewProps) {
  const [storeUi, setStoreUi] = useState<StoreUiState>(INITIAL_STORE_UI_STATE);

  const clampedMemberIndex = Math.min(
    storeUi.memberIndex,
    state.party.length - 1,
  );
  const member = state.party[clampedMemberIndex];
  const packEntries = buildPackEntries(member, state.items);
  const packIndex = Math.min(storeUi.packCursor, packEntries.length - 1);
  const highestLevel = Math.max(...state.party.map((p) => p.level));
  const shopRows = buildShopRows(highestLevel, state.shopStock);
  const shopIndex = Math.min(storeUi.shopCursor, shopRows.length - 1);
  const selectedRow = shopRows[shopIndex];

  // The rare section always restocks on inn rest (ENG-41), but a fresh save
  // or a wiped stock still deserves an immediate roll instead of staying empty.
  useEffect(() => {
    if (state.shopStock.length === 0) dispatch({ type: "RefreshShopStock" });
  }, [state.shopStock.length, dispatch]);

  useInput((input, key) => {
    const keyName = normalizeInkKey(input, key);
    if (!keyName) return;
    const intent = resolveStoreIntent(storeUi.mode, keyName);
    if (!intent) return;

    const result = reduceStoreUi(storeUi, intent, {
      partyLength: state.party.length,
      memberId: member.id,
      packEntries,
      shopRows,
    });

    switch (result.effect?.type) {
      case "storeBuy":
        dispatch({
          type: "StoreBuy",
          itemId: result.effect.itemId,
          quantity: 1,
        });
        break;
      case "storeBuyRolled":
        dispatch({
          type: "StoreBuyRolled",
          instanceId: result.effect.instanceId,
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
          <ShopCatalog
            rows={shopRows}
            cursor={shopIndex}
            state={state}
            highestLevel={highestLevel}
          />
        ) : (
          <BackpackPanel entries={packEntries} cursor={packIndex} />
        )}

        {storeUi.mode === "shop" && selectedRow?.kind === "rolled" ? (
          <ComparePanel
            member={member}
            item={selectedRow.item}
            candidateLabel="For sale"
          />
        ) : null}
      </Box>
    </Screen>
  );
}

interface ShopCatalogProps {
  rows: readonly ShopRow[];
  cursor: number;
  state: GameState;
  highestLevel: number;
}

function ShopCatalog({ rows, cursor, state, highestLevel }: ShopCatalogProps) {
  const locked = nextLockedTier(highestLevel);
  const rareStart = rows.findIndex((row) => row.kind === "rolled");

  return (
    <Box flexDirection="column">
      {rows.map((row, index) => {
        const selected = index === cursor;
        const showHeader = rareStart !== -1 && index === rareStart;
        if (row.kind === "catalog") {
          const item = row.item;
          const owned = isGearShopItem(item.id)
            ? state.items.filter((entry) => entry.baseId === item.id).length
            : (state.inventory.find((entry) => entry.itemId === item.id)
                ?.quantity ?? 0);
          return (
            <Text color={selected ? theme.accent : undefined} key={item.id}>
              {selected ? "> " : "  "}
              {item.name} - buy {item.price}g / sell {sellPriceFor(item)}g
              (owned {owned})
            </Text>
          );
        }
        return (
          <Box flexDirection="column" key={row.item.instanceId}>
            {showHeader ? (
              <Text color={theme.textMuted}>Rare Stock</Text>
            ) : null}
            <Text
              color={selected ? theme.accent : theme.rarity[row.item.rarity]}
            >
              {selected ? "> " : "  "}
              {describeItem(row.item)} - {itemStatLine(row.item)} - buy{" "}
              {rolledItemPrice(row.item)}g
            </Text>
          </Box>
        );
      })}
      {locked !== undefined ? (
        <Text color={theme.textFaint}>
          Locked: more stock unlocks at level {locked}.
        </Text>
      ) : null}
    </Box>
  );
}

interface BackpackPanelProps {
  entries: readonly PackEntry[];
  cursor: number;
}

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
