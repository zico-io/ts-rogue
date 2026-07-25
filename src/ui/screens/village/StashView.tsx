import { Box, Text, useInput } from "ink";
import { useState } from "react";
import {
  describeItem,
  itemSellPrice,
  itemStatLine,
} from "../../../engine/loot/items";
import type { ItemInstance } from "../../../engine/loot/types";
import type { GameEvent, GameState } from "../../../engine/state/types";
import { Screen } from "../../components/Screen";
import { normalizeInkKey } from "../../hooks/normalizeInkKey";
import { theme } from "../../theme";
import { sortBackpackItems } from "../inventory/interaction";
import {
  INITIAL_STASH_UI_STATE,
  reduceStashUi,
  resolveStashIntent,
  type StashUiState,
} from "./interaction";

export interface StashViewProps {
  state: GameState;
  dispatch: (event: GameEvent) => void;
  onBack: () => void;
}

/** Sorted by rarity (then ilvl, then value) so both lists read high-value-first. */
function sortedByRarity(items: readonly ItemInstance[]): ItemInstance[] {
  const byIlvl = sortBackpackItems(items, "ilvl");
  return sortBackpackItems(byIlvl, "rarity");
}

/**
 * Village stash sub-view (ENG-2): unlimited storage for generated gear
 * outside the field backpack's `FIELD_BACKPACK_CAP`. Two modes, mirroring
 * `StoreView`'s shop/pack split: `backpack` lists `state.items` with a
 * deposit action, `stash` lists `state.stash` with a withdraw action (which
 * refuses, with a log line, once the field backpack is already full). Tab
 * switches modes; Esc returns to the village overview.
 */
export function StashView({ state, dispatch, onBack }: StashViewProps) {
  const [ui, setUi] = useState<StashUiState>(INITIAL_STASH_UI_STATE);

  const backpack = sortedByRarity(state.items);
  const stash = sortedByRarity(state.stash);
  const list = ui.mode === "backpack" ? backpack : stash;
  const cursor = Math.min(ui.cursor, list.length - 1);

  useInput((input, key) => {
    const keyName = normalizeInkKey(input, key);
    if (!keyName) return;
    const intent = resolveStashIntent(keyName);
    if (!intent) return;

    const result = reduceStashUi(ui, intent, {
      backpackCount: backpack.length,
      stashCount: stash.length,
    });

    switch (result.effect?.type) {
      case "deposit": {
        const item = backpack[result.effect.index];
        if (item)
          dispatch({ type: "DepositItem", instanceId: item.instanceId });
        break;
      }
      case "withdraw": {
        const item = stash[result.effect.index];
        if (item)
          dispatch({ type: "WithdrawItem", instanceId: item.instanceId });
        break;
      }
      case "back":
        onBack();
        break;
      default:
        break;
    }
    setUi(result.state);
  });

  return (
    <Screen
      state={state}
      title={`Stash - ${ui.mode === "backpack" ? "Backpack" : "Stash"}`}
      hint={
        ui.mode === "backpack"
          ? "Up/down to select, d to deposit, Tab for the stash, Esc to go back."
          : "Up/down to select, w to withdraw, Tab for the backpack, Esc to go back."
      }
    >
      <Box flexDirection="column" gap={1}>
        <Text color={theme.textMuted}>
          Backpack: {state.items.length} / stash: {state.stash.length}{" "}
          (unlimited)
        </Text>
        {list.length === 0 ? (
          <Text color={theme.textMuted}>(empty)</Text>
        ) : (
          <Box flexDirection="column">
            {list.map((item, index) => (
              <Text
                color={
                  index === cursor ? theme.accent : theme.rarity[item.rarity]
                }
                key={item.instanceId}
              >
                {index === cursor ? "> " : "  "}
                {describeItem(item)} - {itemStatLine(item)} - worth{" "}
                {itemSellPrice(item)}g
              </Text>
            ))}
          </Box>
        )}
      </Box>
    </Screen>
  );
}
