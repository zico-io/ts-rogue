import { Box, Text } from "ink";
import { createContext, type ReactNode, useContext } from "react";
import type { GameState } from "../../engine/state/types";
import { MessageLog } from "./MessageLog";
import { lineCount, useTerminalLayout } from "./MinSizeGuard";

export interface ScreenProps {
  state: GameState;
  title: string;
  hint?: string;
  /** Show the message log in the footer. Off for scenes that place it elsewhere (Battle). */
  showLog?: boolean;
  children: ReactNode;
}

/** Drawable dimensions of the scene content region, inside the frame chrome. */
export interface ScreenContent {
  width: number;
  height: number;
}

const ScreenContentContext = createContext<ScreenContent | undefined>(
  undefined,
);

/**
 * Read the drawable size of the current scene's content region (inside the
 * panel border, above the footer). Responsive scenes size their viewports and
 * render helpers from this instead of measuring the raw terminal, so the frame
 * chrome is accounted for in exactly one place.
 */
export function useScreenContent(): ScreenContent {
  const content = useContext(ScreenContentContext);
  if (!content) {
    throw new Error("useScreenContent must be used within a Screen");
  }
  return content;
}

/**
 * Shared scene frame: a full bordered panel that fills the pane, with the scene
 * title in the top border edge, the scene's content in a fixed middle region,
 * and a persistent footer (party vitals, an optional controls hint, and the
 * message log). Every gameplay/village screen renders through this so status
 * placement, height fill, and chrome are identical scene to scene. The content
 * region has a deterministic size (published through `useScreenContent`) so it
 * only reflows when the pane resizes, never when the footer or a child changes.
 */
export function Screen({
  state,
  title,
  hint,
  showLog = true,
  children,
}: ScreenProps) {
  const { columns, rows } = useTerminalLayout();

  // Panel chrome: title line (1 row), body box bottom border (1 row), and the
  // body's left/right border + paddingX (4 cols). The footer stacks below the
  // content: one PartyBar row per member plus a gold line, an optional hint,
  // and an optional fixed-height log. Content takes whatever remains.
  const innerWidth = Math.max(1, columns - 4);
  const partyRows = state.party.length + 1;
  const hintRows = hint ? lineCount(hint, innerWidth) : 0;
  const logLines = showLog ? clamp(Math.round(rows * 0.22), 3, 8) : 0;
  const logBoxRows = showLog ? logLines + 2 : 0;
  const contentHeight = Math.max(
    1,
    rows - 2 - partyRows - hintRows - logBoxRows,
  );
  const content: ScreenContent = { width: innerWidth, height: contentHeight };

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
        <Box flexDirection="column" height={contentHeight} overflow="hidden">
          <ScreenContentContext.Provider value={content}>
            {children}
          </ScreenContentContext.Provider>
        </Box>
        <PartyBar state={state} />
        {hint ? <Text dimColor>{hint}</Text> : null}
        {showLog ? (
          <MessageLog
            messages={state.log}
            height={logBoxRows}
            width={innerWidth}
          />
        ) : null}
      </Box>
    </Box>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
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
