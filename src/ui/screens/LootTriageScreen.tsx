import { Box, Text, useInput } from "ink";
import { useState } from "react";
import {
  describeAffixes,
  describeItem,
  itemStatLine,
} from "../../engine/loot/items";
import type { GameEvent, GameState } from "../../engine/state/types";
import { Screen } from "../components/Screen";
import { normalizeInkKey } from "../hooks/normalizeInkKey";
import { theme } from "../theme";
import {
  INITIAL_LOOT_TRIAGE_UI_STATE,
  reduceLootTriageUi,
  resolveLootTriageIntent,
} from "./lootTriage/interaction";

export interface LootTriageScreenProps {
  state: GameState;
  dispatch: (event: GameEvent) => void;
}

/**
 * Loot triage prompt (ENG-2): a mandatory swap-or-dismantle decision when a
 * field drop overflows the backpack cap. Rendered instead of the active
 * scene while `state.pendingLootTriage` is set (see `app.tsx`), the same
 * "overlay replaces content" pattern `ZoomScreen` uses for `zoomOpen` - so
 * normal scene input can't fire while this is open. There is no "back": the
 * decision must be made before anything else touches the backpack.
 */
export function LootTriageScreen({ state, dispatch }: LootTriageScreenProps) {
  const pending = state.pendingLootTriage;
  const [ui, setUi] = useState(INITIAL_LOOT_TRIAGE_UI_STATE);

  useInput((input, key) => {
    if (!pending) return;
    const keyName = normalizeInkKey(input, key);
    if (!keyName) return;
    const intent = resolveLootTriageIntent(ui.swapping, keyName);
    if (!intent) return;

    const result = reduceLootTriageUi(ui, intent, {
      carriedCount: state.items.length,
    });
    switch (result.effect?.type) {
      case "dismantleDrop":
        dispatch({ type: "ResolveLootTriage", action: "dismantleDrop" });
        setUi(INITIAL_LOOT_TRIAGE_UI_STATE);
        return;
      case "swap": {
        const target = state.items[result.effect.index];
        if (target) {
          dispatch({
            type: "ResolveLootTriage",
            action: "swap",
            instanceId: target.instanceId,
          });
        }
        setUi(INITIAL_LOOT_TRIAGE_UI_STATE);
        return;
      }
      default:
        break;
    }
    setUi(result.state);
  });

  if (!pending) {
    return (
      <Screen state={state} title="Loot Triage">
        <Text color={theme.textMuted}>(nothing pending)</Text>
      </Screen>
    );
  }

  return (
    <Screen
      state={state}
      title="Backpack Full"
      hint={
        ui.swapping
          ? "Up/down to choose a carried item, Enter to dismantle it and keep the drop, Esc to cancel."
          : "d to dismantle the new drop, s to swap it for a carried item instead."
      }
    >
      <Box flexDirection="column" gap={1}>
        <Text color={theme.rarity[pending.drop.rarity]}>
          New drop: {describeItem(pending.drop)} - {itemStatLine(pending.drop)}
        </Text>
        {describeAffixes(pending.drop).map((line) => (
          <Text color={theme.textMuted} key={line}>
            {line}
          </Text>
        ))}
        {ui.swapping ? (
          <Box flexDirection="column">
            <Text>Dismantle which carried item instead?</Text>
            {state.items.map((item, index) => (
              <Text
                color={
                  index === ui.cursor ? theme.accent : theme.rarity[item.rarity]
                }
                key={item.instanceId}
              >
                {index === ui.cursor ? "> " : "  "}
                {describeItem(item)} - {itemStatLine(item)}
              </Text>
            ))}
          </Box>
        ) : (
          <Text color={theme.textMuted}>
            The field backpack is full. Dismantle the new drop for gold, or swap
            it for a carried item (also sold for gold).
          </Text>
        )}
      </Box>
    </Screen>
  );
}
