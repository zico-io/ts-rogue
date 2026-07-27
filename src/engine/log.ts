import type { Element } from "./combat/statusEffects";
import type { Rarity } from "./loot/types";

/** Category of a log line; drives message-log coloring (ROG-31). */
export type LogKind = "damage" | "loot" | "quest" | "system";

/** One game-log line with its display category. */
export interface LogEntry {
  text: string;
  kind: LogKind;

  // Present only for damage lines carrying an elemental flavor, so the UI
  // can color them distinctly. Omitted rather than set to `undefined` to
  // keep GameState strictly JSON-serializable.
  element?: Element;

  /** Optional item rarity for loot lines (ENG-20 loot toast). */
  rarity?: Rarity;
}

/** Optional display tags for a log entry, named so callers never need a positional `undefined` placeholder to reach a later field. */
export interface LogEntryTags {
  element?: Element;
  rarity?: Rarity;
}

/** Build a log entry; `kind` defaults to the neutral system category. */
export function entry(
  text: string,
  kind: LogKind = "system",
  tags?: LogEntryTags,
): LogEntry {
  const e: LogEntry = { text, kind };
  if (tags?.element) e.element = tags.element;
  if (tags?.rarity) e.rarity = tags.rarity;
  return e;
}
