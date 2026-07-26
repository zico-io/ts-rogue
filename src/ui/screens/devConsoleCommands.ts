import type { DebugJournalEntry } from "../../engine/state/incidents";
import type { GameEvent, GameState, Scene } from "../../engine/state/types";

export interface CommandResult {
  clear?: boolean;
  event?: GameEvent;

  createIssue?: { title: string; label: string };

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
