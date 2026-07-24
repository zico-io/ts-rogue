import { Box, Text, useInput } from "ink";
import { useEffect, useState } from "react";
import { atkFrom, defFrom, spdFrom } from "../../../engine/combat/resolution";
import {
  recruitClassName,
  recruitCost,
} from "../../../engine/entities/recruits";
import type { GameEvent, GameState } from "../../../engine/state/types";
import { Screen } from "../../components/Screen";
import { normalizeInkKey } from "../../hooks/normalizeInkKey";
import { theme } from "../../theme";
import {
  INITIAL_TAVERN_UI_STATE,
  reduceTavernUi,
  resolveTavernIntent,
  type TavernUiState,
} from "./interaction";

export interface TavernViewProps {
  state: GameState;
  dispatch: (event: GameEvent) => void;
  onBack: () => void;
}

/**
 * Tavern sub-view (ROG-21). Two modes: `recruit` browses the rotating pool of
 * generated recruits (name, class, level, stats, price) and hires one for gold;
 * `party` lists the current party and dismisses a member (with a confirm; the
 * hero is protected). Tab switches modes; Esc returns to the village overview.
 * The pool rerolls on inn rest; if a save predates the pool it is empty, so the
 * view rolls one on mount. The mode/cursor/confirm state machine lives in the
 * pure `reduceTavernUi` (ROG-45); this component only normalizes Ink's input,
 * resolves an intent, applies the result, and dispatches the mapped event.
 */
export function TavernView({ state, dispatch, onBack }: TavernViewProps) {
  const [tavernUi, setTavernUi] = useState<TavernUiState>(
    INITIAL_TAVERN_UI_STATE,
  );

  // Old saves (and any empty pool) get a fresh roll so the tavern is never bare.
  useEffect(() => {
    if (state.recruits.length === 0) dispatch({ type: "RefreshRecruits" });
  }, [state.recruits.length, dispatch]);

  const recruitIndex = Math.min(
    tavernUi.recruitCursor,
    Math.max(0, state.recruits.length - 1),
  );
  const partyIndex = Math.min(tavernUi.partyCursor, state.party.length - 1);

  useInput((input, key) => {
    const keyName = normalizeInkKey(input, key);
    if (!keyName) return;
    const intent = resolveTavernIntent(
      tavernUi.mode,
      tavernUi.confirmId !== null,
      keyName,
    );
    if (!intent) return;

    const result = reduceTavernUi(tavernUi, intent, {
      recruitsLength: state.recruits.length,
      partyMemberIds: state.party.map((member) => member.id),
    });

    switch (result.effect?.type) {
      case "hire":
        dispatch({ type: "HireRecruit", index: result.effect.index });
        break;
      case "dismiss":
        dispatch({ type: "DismissMember", memberId: result.effect.memberId });
        break;
      case "back":
        onBack();
        break;
      default:
        break;
    }

    setTavernUi(result.state);
  });

  return (
    <Screen
      state={state}
      title={`Tavern - ${tavernUi.mode === "recruit" ? "Recruits" : "Party"}`}
      hint={
        tavernUi.mode === "recruit"
          ? "Up/down to select, h/Enter to hire, Tab for party, Esc to go back."
          : "Up/down to select, d/Enter to dismiss, Tab for recruits, Esc to go back."
      }
    >
      {tavernUi.mode === "recruit" ? (
        <RecruitList recruits={state.recruits} cursor={recruitIndex} />
      ) : (
        <PartyList
          party={state.party}
          cursor={partyIndex}
          confirmId={tavernUi.confirmId}
        />
      )}
    </Screen>
  );
}

interface RecruitListProps {
  recruits: GameState["recruits"];
  cursor: number;
}

function RecruitList({ recruits, cursor }: RecruitListProps) {
  if (recruits.length === 0) {
    return <Text color={theme.textMuted}>The tavern is empty right now.</Text>;
  }
  return (
    <Box flexDirection="column">
      {recruits.map((recruit, index) => (
        <Text
          color={index === cursor ? theme.accent : undefined}
          key={recruit.id}
        >
          {index === cursor ? "> " : "  "}
          {recruit.name} the {recruitClassName(recruit.classId)} - Lv{" "}
          {recruit.level} - ATK {atkFrom(recruit)} DEF {defFrom(recruit)} SPD{" "}
          {spdFrom(recruit)} -{" "}
          <Text color={theme.gold}>{recruitCost(recruit.level)}g</Text>
        </Text>
      ))}
    </Box>
  );
}

interface PartyListProps {
  party: GameState["party"];
  cursor: number;
  confirmId: string | null;
}

function PartyList({ party, cursor, confirmId }: PartyListProps) {
  return (
    <Box flexDirection="column">
      {party.map((member, index) => {
        const isHero = index === 0;
        const confirming = confirmId === member.id;
        return (
          <Text
            color={index === cursor ? theme.accent : undefined}
            key={member.id}
          >
            {index === cursor ? "> " : "  "}
            {member.name} the {recruitClassName(member.classId)} - Lv{" "}
            {member.level}
            {isHero ? (
              <Text color={theme.textFaint}> (hero, cannot dismiss)</Text>
            ) : confirming ? (
              <Text color={theme.gold}> - Dismiss? (y/n)</Text>
            ) : null}
          </Text>
        );
      })}
    </Box>
  );
}
