import { Box, Text, useInput } from "ink";
import { type Dispatch, type SetStateAction, useState } from "react";
import type { DebugJournalEntry } from "../../engine/state/incidents";
import type { GameEvent, GameState, Scene } from "../../engine/state/types";
import type { IncidentPipeline } from "../../lib/incidents";
import {
  flushQueuedIssues,
  readQueuedIssues,
  resolveLinearConfig,
} from "../../lib/linear";
import { useTerminalLayout } from "../components/MinSizeGuard";

interface CommandResult {
  clear?: boolean;
  event?: GameEvent;
  /** Signal to file a Linear issue live; the effect lives in the component. */
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
          "Commands: help, state, debug, scene <name>, log <message>, issue <title>, bug <title>, crash <message>, flush, clear",
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

async function fileIssue(
  state: GameState,
  journal: readonly DebugJournalEntry[],
  createIssue: { title: string; label: string },
  terminal: string,
  pipeline: IncidentPipeline,
  setOutput: Dispatch<SetStateAction<string[]>>,
): Promise<void> {
  const result = await pipeline.submitManual(
    state,
    journal,
    createIssue.title,
    createIssue.label,
    terminal,
  );
  setOutput((output) => [
    ...output,
    result.status === "created"
      ? `Created ${result.identifier}: ${result.url}`
      : result.status === "queued"
        ? "Issue saved to dev-issues.jsonl for retry."
        : result.status === "local"
          ? "Issue saved locally."
          : `Reporting failed: ${result.error}`,
  ]);
}

/** Retry every locally queued issue; report what filed and what remains. */
async function flushOutbox(
  setOutput: Dispatch<SetStateAction<string[]>>,
): Promise<void> {
  const queued = readQueuedIssues();
  if (queued.length === 0) {
    setOutput((o) => [...o, "No queued issues."]);
    return;
  }
  const config = await resolveLinearConfig();
  if (!config) {
    setOutput((o) => [
      ...o,
      `No Vercel identity; ${queued.length} issue(s) still queued.`,
    ]);
    return;
  }
  const { filed, remaining } = await flushQueuedIssues(config);
  setOutput((o) => [
    ...o,
    `Filed ${filed.length}${filed.length ? `: ${filed.join(", ")}` : ""}${remaining ? `; ${remaining} still queued` : ""}.`,
  ]);
}

export interface DevConsoleProps {
  state: GameState;
  dispatch: (event: GameEvent) => void;
  output: string[];
  setOutput: Dispatch<SetStateAction<string[]>>;
  journal: readonly DebugJournalEntry[];
  pipeline: IncidentPipeline;
  crash: (message: string) => void;
}

export function DevConsole({
  state,
  dispatch,
  output,
  setOutput,
  journal,
  pipeline,
  crash,
}: DevConsoleProps) {
  const [input, setInput] = useState("");
  const { columns, rows } = useTerminalLayout();

  useInput((character, key) => {
    if (character === "`") return;
    if (key.return) {
      const result = runDevCommand(input, state, journal);
      if (result.event) dispatch(result.event);
      setOutput(
        result.clear ? [] : [...output, `> ${input}`, ...result.output],
      );
      if (result.createIssue) {
        void fileIssue(
          state,
          journal,
          result.createIssue,
          `${columns}x${rows}`,
          pipeline,
          setOutput,
        );
      }
      if (result.flushIssues) void flushOutbox(setOutput);
      if (result.crash) crash(result.crash);
      setInput("");
    } else if (key.backspace || key.delete) {
      setInput((value) => value.slice(0, -1));
    } else if (character && !key.ctrl && !key.meta) {
      setInput((value) => value + character);
    }
  });

  const lines = [
    ...state.log.map((line) => `[game] ${line.text}`),
    ...output,
  ].slice(-Math.max(1, rows - 4));

  return (
    <Box flexDirection="column" height={rows}>
      <Text bold>Game Console</Text>
      <Text dimColor>
        Press ` to return to the game. Run help for commands.
      </Text>
      <Box flexDirection="column" flexGrow={1}>
        <Text>{lines.join("\n")}</Text>
      </Box>
      <Text>&gt; {input}</Text>
    </Box>
  );
}
