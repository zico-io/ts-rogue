import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { SHOP_ITEMS, sellPriceFor } from "../../../data/shops.js";
import type { GameEvent, GameState } from "../../../engine/state/types.js";
import { MessageLog } from "../../components/MessageLog.js";

export interface StoreViewProps {
  state: GameState;
  dispatch: (event: GameEvent) => void;
  onBack: () => void;
}

/** Store sub-view: browse the static shop catalog, buy/sell one unit at a time. */
export function StoreView({ state, dispatch, onBack }: StoreViewProps) {
  const [cursor, setCursor] = useState(0);
  const selected = SHOP_ITEMS[cursor];

  useInput((input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (key.upArrow) {
      setCursor(
        (current) => (current + SHOP_ITEMS.length - 1) % SHOP_ITEMS.length,
      );
      return;
    }
    if (key.downArrow) {
      setCursor((current) => (current + 1) % SHOP_ITEMS.length);
      return;
    }
    if (input === "b") {
      dispatch({ type: "StoreBuy", itemId: selected.id, quantity: 1 });
      return;
    }
    if (input === "s") {
      dispatch({ type: "StoreSell", itemId: selected.id, quantity: 1 });
    }
  });

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Store</Text>
      <Text>Gold: {state.gold}</Text>
      <Box flexDirection="column">
        {SHOP_ITEMS.map((item, index) => {
          const owned =
            state.inventory.find((entry) => entry.itemId === item.id)
              ?.quantity ?? 0;
          return (
            <Text color={index === cursor ? "green" : undefined} key={item.id}>
              {index === cursor ? "> " : "  "}
              {item.name} - buy {item.price}g / sell {sellPriceFor(item)}g
              (owned {owned})
            </Text>
          );
        })}
      </Box>
      <Text dimColor>
        Up/down to select, b to buy 1, s to sell 1, Esc to go back.
      </Text>
      <MessageLog messages={state.log} />
    </Box>
  );
}
