/**
 * Pure HUD/screen-chrome builder (ROG-47), the first real consumer of the
 * ROG-56 scene tree. Extracts `Screen.tsx`'s original chrome layout (bordered
 * panel + title, footer party bar, optional hint, optional message log) into
 * a framework-free function so both the Ink interpreter (`Screen.tsx`) and
 * the Pixi interpreter (`src/web/render/sceneView.ts`) draw the exact same
 * tree instead of maintaining two hand-written implementations.
 *
 * `buildChrome` takes the available size in the caller's `Unit` (1 unit = 1
 * terminal cell for Ink, 1 unit = N atlas px for Pixi - see `tree.ts`) and
 * returns both the chrome `PanelNode` and the content-region size, which is
 * `useScreenContent`'s contract: scenes size their own viewport from the
 * content region a single layout computation produced, not from raw
 * terminal/canvas dimensions.
 *
 * No imports from `ink`, `pixi.js`, or `react`.
 */

import type { PartyMember } from "../../engine/entities/party";
import type { GameState } from "../../engine/state/types";
import { hpColor, mpColor, theme } from "../theme";
import type { AnyNode, PanelNode, StackNode, Unit } from "./tree";

export interface ChromeSize {
  width: Unit;
  height: Unit;
}

export interface ChromeOptions {
  title: string;
  hint?: string;
  /** Show the message log in the footer. Off for scenes that place it elsewhere (Battle). */
  showLog?: boolean;
}

export interface ChromeResult {
  panel: PanelNode;
  /** Drawable content-region size, in the same `Unit` `size` was given in. */
  content: ChromeSize;
}

/** Glyph-bar width (in `Unit`) for the HP/MP meters; matches the original Ink bar widths. */
const HP_METER_WIDTH: Unit = 10;
const MP_METER_WIDTH: Unit = 6;

/**
 * Panel chrome overhead: title line (1 unit) and the body's bottom border (1
 * unit). Mirrors `Screen.tsx`'s original `rows - 2` budget.
 */
const PANEL_OVERHEAD_HEIGHT: Unit = 2;
/** Body left/right border + paddingX (1 unit each side), mirrors `columns - 4`. */
const PANEL_OVERHEAD_WIDTH: Unit = 4;

const DEFAULT_LOG_LINES_MIN = 3;
const DEFAULT_LOG_LINES_MAX = 8;
const LOG_HEIGHT_RATIO = 0.22;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/**
 * Upper bound on how many lines `text` wraps to at `width` units. Mirrors
 * `lineCount` in `src/ui/components/MinSizeGuard.tsx`, duplicated here so
 * this module stays framework-free (that file imports `ink`/`react`).
 */
function estimateLineCount(text: string, width: Unit): number {
  if (width <= 0) return 1;
  return Math.max(1, Math.ceil(text.length / width));
}

/** One footer row: name/level, then an HP meter and an MP meter with their numbers. */
function partyRow(member: PartyMember): StackNode {
  const hpTone = hpColor(member.hp, member.maxHp);
  const mpTone = mpColor(member.mp, member.maxMp);
  const children: AnyNode[] = [
    {
      key: `chrome-party-${member.id}-name`,
      kind: "text",
      text: `${member.name.padEnd(8)} Lv${member.level}  `,
      color: theme.text,
    },
    {
      key: `chrome-party-${member.id}-hp-label`,
      kind: "text",
      text: "HP ",
      color: hpTone,
    },
    {
      key: `chrome-party-${member.id}-hp-meter`,
      kind: "meter",
      value: member.hp,
      max: member.maxHp,
      color: hpTone,
      width: HP_METER_WIDTH,
    },
    {
      key: `chrome-party-${member.id}-hp-value`,
      kind: "text",
      text: ` ${member.hp}/${member.maxHp}`,
      color: hpTone,
    },
    {
      key: `chrome-party-${member.id}-gap`,
      kind: "text",
      text: "   ",
      color: theme.text,
    },
    {
      key: `chrome-party-${member.id}-mp-label`,
      kind: "text",
      text: "MP ",
      color: mpTone,
    },
    {
      key: `chrome-party-${member.id}-mp-meter`,
      kind: "meter",
      value: member.mp,
      max: member.maxMp,
      color: mpTone,
      width: MP_METER_WIDTH,
    },
    {
      key: `chrome-party-${member.id}-mp-value`,
      kind: "text",
      text: ` ${member.mp}/${member.maxMp}`,
      color: mpTone,
    },
  ];
  return {
    key: `chrome-party-${member.id}`,
    kind: "stack",
    direction: "row",
    children,
  };
}

/**
 * Builds the shared HUD chrome: a titled panel whose children are the footer
 * (one party row per member plus a gold line), an optional hint line, and an
 * optional message log - the same regions `Screen.tsx` used to hand-render.
 * Also returns the content-region size so callers/interpreters can publish
 * it through `useScreenContent`'s contract.
 */
export function buildChrome(
  state: GameState,
  size: ChromeSize,
  opts: ChromeOptions,
): ChromeResult {
  const { title, hint, showLog = true } = opts;
  const innerWidth = Math.max(1, size.width - PANEL_OVERHEAD_WIDTH);
  const partyRows = state.party.length + 1; // one row per member + gold line
  const hintRows = hint ? estimateLineCount(hint, innerWidth) : 0;
  const logLines = showLog
    ? clamp(
        Math.round(size.height * LOG_HEIGHT_RATIO),
        DEFAULT_LOG_LINES_MIN,
        DEFAULT_LOG_LINES_MAX,
      )
    : 0;
  const logBoxHeight = showLog ? logLines + 2 : 0;
  const contentHeight = Math.max(
    1,
    size.height - PANEL_OVERHEAD_HEIGHT - partyRows - hintRows - logBoxHeight,
  );
  const content: ChromeSize = { width: innerWidth, height: contentHeight };

  const footerChildren: AnyNode[] = state.party.map(partyRow);
  footerChildren.push({
    key: "chrome-gold",
    kind: "text",
    text: `Gold ${state.gold}`,
    color: theme.gold,
  });
  const footer: StackNode = {
    key: "chrome-footer",
    kind: "stack",
    direction: "column",
    children: footerChildren,
  };

  const panelChildren: AnyNode[] = [footer];
  if (hint) {
    panelChildren.push({
      key: "chrome-hint",
      kind: "text",
      text: hint,
      color: theme.textMuted,
    });
  }
  if (showLog) {
    panelChildren.push({
      key: "chrome-log",
      kind: "log",
      messages: state.log,
      maxLines: logLines,
    });
  }

  const panel: PanelNode = {
    key: "chrome-panel",
    kind: "panel",
    title,
    children: panelChildren,
  };

  return { panel, content };
}
