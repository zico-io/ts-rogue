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
