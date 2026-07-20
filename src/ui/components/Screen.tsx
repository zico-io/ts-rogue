import { Box, Text, useWindowSize } from "ink";
import type { ReactNode } from "react";
import type { GameState } from "../../engine/state/types";
import { MessageLog } from "./MessageLog";

export interface ScreenProps {
  state: GameState;
  title: string;
  hint?: string;
  children: ReactNode;
}

/**
 * Shared scene frame: a full bordered panel that fills the pane, with the scene
 * title in the top border edge, the scene's content in the growing middle, and
 * a persistent footer (party vitals, an optional controls hint, and the message
 * log). Every gameplay/village screen renders through this so status placement,
 * height fill, and chrome are identical scene to scene.
 */
export function Screen({ state, title, hint, children }: ScreenProps) {
  const { columns, rows } = useWindowSize();

  return (
    <Box flexDirection="column" height={rows} width={columns}>
      <Text dimColor>{titledTop(title, columns)}</Text>
      <Box
        borderStyle="single"
        borderTop={false}
        borderDimColor
        flexDirection="column"
        flexGrow={1}
        paddingX={1}
      >
        <Box flexDirection="column" flexGrow={1}>
          {children}
        </Box>
        <PartyBar state={state} />
        {hint ? <Text dimColor>{hint}</Text> : null}
        <MessageLog messages={state.log} />
      </Box>
    </Box>
  );
}

/**
 * Build the panel's titled top edge to span `width`. The manual line pairs with
 * the body box's `borderTop={false}` so the corners line up seamlessly.
 * ponytail: string math instead of a titled-border lib; Ink has none. Truncates
 * on panes too narrow for the title.
 */
function titledTop(title: string, width: number): string {
  const w = Math.max(2, width);
  const label = ` ${title} `;
  const head = `┌─${label}`; // ┌─ Title
  if (head.length + 1 >= w) return `┌${"─".repeat(w - 2)}┐`;
  return `${head}${"─".repeat(w - head.length - 1)}┐`;
}

/** Persistent footer vitals: one row per party member plus gold. */
function PartyBar({ state }: { state: GameState }) {
  return (
    <Box flexDirection="column">
      {state.party.map((member) => (
        <Text key={member.id}>
          {member.name.padEnd(8)} Lv{member.level} {"  "}
          <Text color={hpColor(member.hp, member.maxHp)}>
            HP {member.hp}/{member.maxHp}
          </Text>
          {"   "}
          <Text color="cyan">
            MP {member.mp}/{member.maxMp}
          </Text>
        </Text>
      ))}
      <Text color="yellow">Gold {state.gold}</Text>
    </Box>
  );
}

/** HP color by remaining fraction: green healthy, yellow hurt, red critical. */
function hpColor(hp: number, maxHp: number): string {
  const ratio = maxHp > 0 ? hp / maxHp : 0;
  if (ratio <= 0.25) return "red";
  if (ratio <= 0.5) return "yellow";
  return "green";
}
