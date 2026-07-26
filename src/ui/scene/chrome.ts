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

  showLog?: boolean;
}

export interface ChromeResult {
  panel: PanelNode;

  content: ChromeSize;
}

const HP_METER_WIDTH: Unit = 10;
const MP_METER_WIDTH: Unit = 6;

const PANEL_OVERHEAD_HEIGHT: Unit = 2;

const PANEL_OVERHEAD_WIDTH: Unit = 4;

const DEFAULT_LOG_LINES_MIN = 3;
const DEFAULT_LOG_LINES_MAX = 8;
const LOG_HEIGHT_RATIO = 0.22;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function estimateLineCount(text: string, width: Unit): number {
  if (width <= 0) return 1;
  return Math.max(1, Math.ceil(text.length / width));
}

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

export function buildChrome(
  state: GameState,
  size: ChromeSize,
  opts: ChromeOptions,
): ChromeResult {
  const { title, hint, showLog = true } = opts;
  const innerWidth = Math.max(1, size.width - PANEL_OVERHEAD_WIDTH);
  const partyRows = state.party.length + 1;
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
