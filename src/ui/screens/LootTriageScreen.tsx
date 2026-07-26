import { Box, Text, useInput } from "ink";
import { useState } from "react";
import {
  describeItem,
  itemSellPrice,
  itemStatLine,
} from "../../engine/loot/items";
import type { GameEvent, GameState } from "../../engine/state/types";
import { Screen } from "../components/Screen";
import { normalizeInkKey } from "../hooks/normalizeInkKey";
import { theme } from "../theme";
import {
  INITIAL_LOOT_TRIAGE_UI_STATE,
  type LootTriageUiState,
  reduceLootTriageUi,
  resolveLootTriageIntent,
} from "./lootTriage/interaction";

export interface LootTriageScreenProps {
  state: GameState;
  dispatch: (event: GameEvent) => void;
}

/**
 * Mandatory full-backpack triage overlay (ENG-5): renders whenever
 * `state.pendingLootTriage` holds a queued overflow drop (see `app.tsx`'s
 * `content` selection, ahead of every normal scene so the decision can't be
 * skipped - mirrors `ZoomScreen`'s overlay pattern, but driven directly by
 * state instead of a local open/close toggle). Offers swap (dismantle a
 * carried item, then the drop fills the freed slot) or dismantle the drop
 * itself - no silent loss either way. Resolves one queued drop per
 * decision; the overlay stays up until the queue empties.
 */
export function LootTriageScreen({ state, dispatch }: LootTriageScreenProps) {
  const [ui, setUi] = useState<LootTriageUiState>(INITIAL_LOOT_TRIAGE_UI_STATE);
  const drop = state.pendingLootTriage?.drops[0];

  useInput((input, key) => {
    if (!drop) return;
    const keyName = normalizeInkKey(input, key);
    if (!keyName) return;
    const intent = resolveLootTriageIntent(ui.mode, keyName);
    if (!intent) return;

    const result = reduceLootTriageUi(ui, intent, { carried: state.items });
    switch (result.effect?.type) {
      case "dismantleDrop":
        dispatch({ type: "ResolveLootTriage", action: "dismantleDrop" });
        setUi(INITIAL_LOOT_TRIAGE_UI_STATE);
        return;
      case "dismantleCarried":
        dispatch({
          type: "ResolveLootTriage",
          action: "dismantleCarried",
          instanceId: result.effect.instanceId,
        });
        setUi(INITIAL_LOOT_TRIAGE_UI_STATE);
        return;
      default:
        break;
    }
    setUi(result.state);
  });

  if (!drop) return null;

  const remaining = state.pendingLootTriage?.drops.length ?? 0;

  return (
    <Screen
      state={state}
      title="Backpack Full"
      hint={
        ui.mode === "choose"
          ? "s to swap (dismantle a carried item), d to dismantle the drop."
          : "Up/down to pick a carried item, Enter to dismantle it and take the drop, Esc to go back."
      }
    >
      <Box flexDirection="column" gap={1}>
        <Text color={theme.warn}>
          Your backpack is full.{" "}
          {remaining > 1
            ? `${remaining} drops await a decision.`
            : "This drop awaits a decision."}
        </Text>
        <Text color={theme.rarity[drop.rarity]}>
          {describeItem(drop)} - {itemStatLine(drop)}
        </Text>
        {ui.mode === "choose" ? (
          <Box flexDirection="column">
            <Text color={theme.textMuted}>
              [s] Swap: dismantle a carried item for gold, then carry this
              instead.
            </Text>
            <Text color={theme.textMuted}>
              [d] Dismantle: sell this drop for gold and keep your current
              backpack.
            </Text>
          </Box>
        ) : (
          <Box flexDirection="column">
            {state.items.map((item, index) => (
              <Text
                color={
                  index === ui.carriedCursor
                    ? theme.accent
                    : theme.rarity[item.rarity]
                }
                key={item.instanceId}
              >
                {index === ui.carriedCursor ? "> " : "  "}
                {describeItem(item)} - sell {itemSellPrice(item)}g
              </Text>
            ))}
          </Box>
        )}
      </Box>
    </Screen>
  );
}
