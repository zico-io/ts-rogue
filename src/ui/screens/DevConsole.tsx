import { Box, Text, useInput } from "ink";
import { type Dispatch, type SetStateAction, useState } from "react";
import type { DebugJournalEntry } from "../../engine/state/incidents";
import type { GameEvent, GameState } from "../../engine/state/types";
import type { IncidentPipeline } from "../../lib/incidents";
import {
  flushQueuedIssues,
  readQueuedIssues,
  resolveLinearConfig,
} from "../../lib/linear";
import { useTerminalLayout } from "../components/MinSizeGuard";
import { type CommandResult, runDevCommand } from "./devConsoleCommands";

// `runDevCommand`/`CommandResult` now live in `devConsoleCommands.ts` (ROG-48)
// so the browser renderer's dev console can share them without importing
// Ink. Re-exported here so `DevConsole.test.ts`'s existing import keeps
// working unchanged.
export { type CommandResult, runDevCommand };

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
