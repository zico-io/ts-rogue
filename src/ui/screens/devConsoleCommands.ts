/**
 * Dev console command interpreter (ROG-48): extracted from `DevConsole.tsx`
 * so the browser renderer's dev console (`src/web/devConsole.ts`) can run
 * the exact same commands without importing Ink. Framework-free and pure -
 * every effect (dispatching a `GameEvent`, filing a Linear issue, crashing)
 * is returned as a signal the caller applies, never performed here.
 */

import type { DebugJournalEntry } from "../../engine/state/incidents";
import type { GameEvent, GameState, Scene } from "../../engine/state/types";

export interface CommandResult {
  clear?: boolean;
  event?: GameEvent;
  /** Signal to file a Linear issue live; the effect lives in the caller. */
  createIssue?: { title: string; label: string };
  /** Signal to retry every locally queued issue. */
  flushIssues?: boolean;
  crash?: string;
  output: string[];
}

const scenes: readonly Scene[] = ["village", "overworld", "dungeon", "battle"];

export function runDevCommand(
  command: string,
  state: GameState,
  journal: readonly DebugJournalEntry[] = [],
): CommandResult {
  const [name = "", ...args] = command.trim().split(/\s+/);
  const value = args.join(" ");

  switch (name) {
    case "":
      return { output: [] };
    case "clear":
      return { clear: true, output: [] };
    case "help":
      return {
        output: [
          "Commands: help, state, debug, scene <name>, log <message>, recruit <classId>, issue <title>, bug <title>, crash <message>, flush, clear",
        ],
      };
    case "state":
      return { output: JSON.stringify(state, null, 2).split("\n") };
    case "debug":
      return {
        output: journal.length
          ? JSON.stringify(journal, null, 2).split("\n")
          : ["Debug journal is empty"],
      };
    case "scene":
      if (scenes.includes(value as Scene)) {
        return {
          event: { type: "ChangeScene", scene: value as Scene },
          output: [`Scene changed to ${value}`],
        };
      }
      return { output: [`Usage: scene ${scenes.join("|")}`] };
    case "log":
      return value
        ? {
            event: { type: "Log", message: value },
            output: ["Message logged"],
          }
        : { output: ["Usage: log <message>"] };
    case "recruit":
      return value
        ? {
            event: { type: "RecruitMember", classId: value },
            output: [`Recruiting ${value} ...`],
          }
        : { output: ["Usage: recruit <classId>"] };
    case "issue":
    case "bug":
      return value
        ? {
            createIssue: {
              title: value,
              label: name === "bug" ? "bug" : "feature",
            },
            output: [`Filing Linear issue: ${value} ...`],
          }
        : { output: [`Usage: ${name} <title>`] };
    case "flush":
      return { flushIssues: true, output: ["Flushing queued issues ..."] };
    case "crash":
      return value
        ? { crash: value, output: [`Crashing: ${value}`] }
        : { output: ["Usage: crash <message>"] };
    default:
      return { output: [`Unknown command: ${name}. Run help.`] };
  }
}
