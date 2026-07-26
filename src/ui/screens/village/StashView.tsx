import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { FIELD_BACKPACK_CAP } from "../../../engine/loot/inventory";
import {
  describeItem,
  itemSellPrice,
  itemStatLine,
} from "../../../engine/loot/items";
import type { GameEvent, GameState } from "../../../engine/state/types";
import { Screen } from "../../components/Screen";
import { normalizeInkKey } from "../../hooks/normalizeInkKey";
import { theme } from "../../theme";
import { SORT_KEYS, sortPackEntries } from "../inventory/interaction";
import {
  buildStashEntries,
  INITIAL_STASH_UI_STATE,
  type PackEntry,
  reduceStashUi,
  resolveStashIntent,
  type StashUiState,
} from "./interaction";

export interface StashViewProps {
  state: GameState;
  dispatch: (event: GameEvent) => void;
  onBack: () => void;
}

/**
 * Village Stash sub-view (ENG-5): unlimited town storage for generated
 * gear, separate from the field backpack's tunable cap
 * (`FIELD_BACKPACK_CAP`). Two Tab-cycled panes mirror `StoreView`'s
 * shop/pack split - "Backpack" lists `state.items` (sorted with the
 * Inventory screen's `sortPackEntries`, `[d]` to deposit the selected item)
 * and "Stash" lists `state.stash` (`[w]` to withdraw). Unlike the Store,
 * `items`/`stash` are party-shared, not per-member, so there is no member
 * switcher. The mode/cursor/sort state machine lives in the pure
 * `reduceStashUi`; this component only normalizes Ink's input, resolves an
 * intent, applies the result, and dispatches the mapped event.
 */
export function StashView({ state, dispatch, onBack }: StashViewProps) {
  const [stashUi, setStashUi] = useState<StashUiState>(INITIAL_STASH_UI_STATE);

  const backpackEntries = sortPackEntries(
    buildStashEntries(state.items),
    stashUi.sortKey,
  ).filter(
    (entry): entry is Extract<PackEntry, { kind: "backpack" }> =>
      entry.kind === "backpack",
  );
  const stashEntries = sortPackEntries(
    buildStashEntries(state.stash),
    stashUi.sortKey,
  ).filter(
    (entry): entry is Extract<PackEntry, { kind: "backpack" }> =>
      entry.kind === "backpack",
  );
  const backpackIndex = Math.min(
    stashUi.backpackCursor,
    backpackEntries.length - 1,
  );
  const stashIndex = Math.min(stashUi.stashCursor, stashEntries.length - 1);

  useInput((input, key) => {
    const keyName = normalizeInkKey(input, key);
    if (!keyName) return;
    const intent = resolveStashIntent(stashUi.mode, keyName);
    if (!intent) return;

    const result = reduceStashUi(stashUi, intent, {
      backpackEntries,
      stashEntries,
      sortKeys: SORT_KEYS,
    });

    switch (result.effect?.type) {
      case "deposit":
        dispatch({ type: "DepositItem", instanceId: result.effect.instanceId });
        break;
      case "withdraw":
        dispatch({
          type: "WithdrawItem",
          instanceId: result.effect.instanceId,
        });
        break;
      case "back":
        onBack();
        break;
      default:
        break;
    }

    setStashUi(result.state);
  });

  return (
    <Screen
      state={state}
      title={`Stash - ${stashUi.mode === "backpack" ? "Backpack" : "Stash"}`}
      hint={
        stashUi.mode === "backpack"
          ? `Up/down to select, d to deposit, r to cycle sort (${stashUi.sortKey}), Tab for stash, Esc to go back.`
          : `Up/down to select, w to withdraw, r to cycle sort (${stashUi.sortKey}), Tab for backpack, Esc to go back.`
      }
    >
      <Box flexDirection="column" gap={1}>
        <Text>
          Backpack: {state.items.length}/{FIELD_BACKPACK_CAP}
        </Text>
        {stashUi.mode === "backpack" ? (
          <GearPanel
            action="d deposit"
            cursor={backpackIndex}
            entries={backpackEntries}
          />
        ) : (
          <GearPanel
            action="w withdraw"
            cursor={stashIndex}
            entries={stashEntries}
          />
        )}
      </Box>
    </Screen>
  );
}

interface GearPanelProps {
  entries: readonly Extract<PackEntry, { kind: "backpack" }>[];
  cursor: number;
  action: string;
}

function GearPanel({ entries, cursor, action }: GearPanelProps) {
  if (entries.length === 0) {
    return <Text color={theme.textMuted}>(empty)</Text>;
  }
  return (
    <Box flexDirection="column">
      {entries.map((entry, index) => {
        const selectedRow = index === cursor;
        return (
          <Text
            color={selectedRow ? theme.accent : theme.rarity[entry.item.rarity]}
            key={entry.item.instanceId}
          >
            {selectedRow ? "> " : "  "}
            {describeItem(entry.item)} - {itemStatLine(entry.item)} - sell{" "}
            {itemSellPrice(entry.item)}g [{action}]
          </Text>
        );
      })}
    </Box>
  );
}
