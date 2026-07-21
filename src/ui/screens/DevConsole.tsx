import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { Box, Text, useInput } from "ink";
import { type Dispatch, type SetStateAction, useState } from "react";
import type { GameEvent, GameState, Scene } from "../../engine/state/types";
import {
  buildIssueBody,
  createLinearIssue,
  flushQueuedIssues,
  ISSUE_OUTBOX,
  queueIssue,
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
  output: string[];
}

const scenes: readonly Scene[] = ["village", "overworld", "dungeon", "battle"];

export function runDevCommand(
  command: string,
  state: GameState,
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
          "Commands: help, state, scene <name>, log <message>, issue <title>, bug <title>, flush, clear",
        ],
      };
    case "state":
      return { output: JSON.stringify(state, null, 2).split("\n") };
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
    default:
      return { output: [`Unknown command: ${name}. Run help.`] };
  }
}

/** Read the tmux play harness key log, only inside a harness-driven session. */
function readPlayKeys(): string | undefined {
  if (!process.env.TS_ROGUE_PLAY) return undefined;
  try {
    return readFileSync(".play-keys.log", "utf8") || undefined;
  } catch {
    return undefined;
  }
}

/** Capture the harness's own tmux pane (plain, for the issue's Screen block). */
function readPlayFrame(): string | undefined {
  if (!process.env.TS_ROGUE_PLAY) return undefined;
  try {
    return (
      execFileSync("tmux", ["capture-pane", "-t", "rogue", "-p"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }) || undefined
    );
  } catch {
    return undefined;
  }
}

function gitCommit(): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

/**
 * File the issue live from the Ink layer (I/O belongs here, not in the pure
 * parser or reducer - the church save follows the same split). Builds a
 * reproducible body from the current session and appends the outcome.
 */
async function fileIssue(
  state: GameState,
  createIssue: { title: string; label: string },
  terminal: string,
  setOutput: Dispatch<SetStateAction<string[]>>,
): Promise<void> {
  // Build the full metadata body up front so a queued issue keeps its repro
  // context even when no credentials are available to send it.
  const input = {
    title: createIssue.title,
    label: createIssue.label,
    body: buildIssueBody({
      seed: state.seed,
      scene: state.scene,
      state,
      logTail: state.log.slice(-12),
      keySequence: readPlayKeys(),
      frame: readPlayFrame(),
      commit: gitCommit(),
      node: process.version,
      terminal,
    }),
  };

  const config = await resolveLinearConfig();
  if (!config) {
    const queued = queueIssue(
      input,
      "vercel-identity-unavailable",
      new Date().toISOString(),
    );
    setOutput((o) => [
      ...o,
      `No Vercel identity; issue saved to ${ISSUE_OUTBOX} (${queued} queued). Run flush once connected.`,
    ]);
    return;
  }

  try {
    const issue = await createLinearIssue(input, config);
    setOutput((o) => [...o, `Created ${issue.identifier}: ${issue.url}`]);
    // Opportunistically drain anything queued while credentials were down.
    const { filed, remaining } = await flushQueuedIssues(config);
    if (filed.length > 0) {
      setOutput((o) => [
        ...o,
        `Also filed ${filed.length} queued: ${filed.join(", ")}${remaining ? ` (${remaining} still queued)` : ""}`,
      ]);
    }
  } catch (err) {
    const queued = queueIssue(
      input,
      (err as Error).message,
      new Date().toISOString(),
    );
    setOutput((o) => [
      ...o,
      `Filing failed; saved to ${ISSUE_OUTBOX} (${queued} queued): ${(err as Error).message}`,
    ]);
  }
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
}

export function DevConsole({
  state,
  dispatch,
  output,
  setOutput,
}: DevConsoleProps) {
  const [input, setInput] = useState("");
  const { columns, rows } = useTerminalLayout();

  useInput((character, key) => {
    if (character === "`") return;
    if (key.return) {
      const result = runDevCommand(input, state);
      if (result.event) dispatch(result.event);
      setOutput(
        result.clear ? [] : [...output, `> ${input}`, ...result.output],
      );
      if (result.createIssue) {
        void fileIssue(
          state,
          result.createIssue,
          `${columns}x${rows}`,
          setOutput,
        );
      }
      if (result.flushIssues) void flushOutbox(setOutput);
      setInput("");
    } else if (key.backspace || key.delete) {
      setInput((value) => value.slice(0, -1));
    } else if (character && !key.ctrl && !key.meta) {
      setInput((value) => value + character);
    }
  });

  const lines = [...state.log.map((line) => `[game] ${line}`), ...output].slice(
    -Math.max(1, rows - 4),
  );

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
