import { Box, Text, useInput } from "ink";
import { useEffect, useState } from "react";
import { atkFrom, defFrom, spdFrom } from "../../../engine/combat/resolution";
import {
  recruitClassName,
  recruitCost,
} from "../../../engine/entities/recruits";
import type { GameEvent, GameState } from "../../../engine/state/types";
import { Screen } from "../../components/Screen";
import { theme } from "../../theme";

export interface TavernViewProps {
  state: GameState;
  dispatch: (event: GameEvent) => void;
  onBack: () => void;
}

type TavernMode = "recruit" | "party";

/**
 * Tavern sub-view (ROG-21). Two modes: `recruit` browses the rotating pool of
 * generated recruits (name, class, level, stats, price) and hires one for gold;
 * `party` lists the current party and dismisses a member (with a confirm; the
 * hero is protected). Tab switches modes; Esc returns to the village overview.
 * The pool rerolls on inn rest; if a save predates the pool it is empty, so the
 * view rolls one on mount.
 */
export function TavernView({ state, dispatch, onBack }: TavernViewProps) {
  const [mode, setMode] = useState<TavernMode>("recruit");
  const [recruitCursor, setRecruitCursor] = useState(0);
  const [partyCursor, setPartyCursor] = useState(0);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // Old saves (and any empty pool) get a fresh roll so the tavern is never bare.
  useEffect(() => {
    if (state.recruits.length === 0) dispatch({ type: "RefreshRecruits" });
  }, [state.recruits.length, dispatch]);

  const recruitIndex = Math.min(
    recruitCursor,
    Math.max(0, state.recruits.length - 1),
  );
  const partyIndex = Math.min(partyCursor, state.party.length - 1);

  useInput((input, key) => {
    if (key.escape) {
      if (confirmId) setConfirmId(null);
      else onBack();
      return;
    }
    if (key.tab) {
      setMode((current) => (current === "recruit" ? "party" : "recruit"));
      setRecruitCursor(0);
      setPartyCursor(0);
      setConfirmId(null);
      return;
    }

    if (mode === "recruit") {
      if (state.recruits.length === 0) return;
      if (key.upArrow) {
        setRecruitCursor(
          (c) => (c + state.recruits.length - 1) % state.recruits.length,
        );
        return;
      }
      if (key.downArrow) {
        setRecruitCursor((c) => (c + 1) % state.recruits.length);
        return;
      }
      if (key.return || input === "h") {
        dispatch({ type: "HireRecruit", index: recruitIndex });
      }
      return;
    }

    // mode === "party"
    const member = state.party[partyIndex];
    if (confirmId) {
      if (key.return || input === "y") {
        dispatch({ type: "DismissMember", memberId: confirmId });
        setConfirmId(null);
      } else if (input === "n") {
        setConfirmId(null);
      }
      return;
    }
    if (key.upArrow) {
      setPartyCursor((c) => (c + state.party.length - 1) % state.party.length);
      return;
    }
    if (key.downArrow) {
      setPartyCursor((c) => (c + 1) % state.party.length);
      return;
    }
    // Index 0 is the hero and can never be dismissed.
    if ((key.return || input === "d") && member && partyIndex !== 0) {
      setConfirmId(member.id);
    }
  });

  return (
    <Screen
      state={state}
      title={`Tavern - ${mode === "recruit" ? "Recruits" : "Party"}`}
      hint={
        mode === "recruit"
          ? "Up/down to select, h/Enter to hire, Tab for party, Esc to go back."
          : "Up/down to select, d/Enter to dismiss, Tab for recruits, Esc to go back."
      }
    >
      {mode === "recruit" ? (
        <RecruitList recruits={state.recruits} cursor={recruitIndex} />
      ) : (
        <PartyList
          party={state.party}
          cursor={partyIndex}
          confirmId={confirmId}
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
