import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { GameEvent, GameState, Scene } from "../../engine/state/types";
import { useTerminalLayout } from "../components/MinSizeGuard";

interface CommandResult {
  clear?: boolean;
  event?: GameEvent;
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
        output: ["Commands: help, state, scene <name>, log <message>, clear"],
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
    default:
      return { output: [`Unknown command: ${name}. Run help.`] };
  }
}

export interface DevConsoleProps {
  state: GameState;
  dispatch: (event: GameEvent) => void;
  output: string[];
  setOutput: (output: string[]) => void;
}

export function DevConsole({
  state,
  dispatch,
  output,
  setOutput,
}: DevConsoleProps) {
  const [input, setInput] = useState("");
  const { rows } = useTerminalLayout();

  useInput((character, key) => {
    if (character === "`") return;
    if (key.return) {
      const result = runDevCommand(input, state);
      if (result.event) dispatch(result.event);
      setOutput(
        result.clear ? [] : [...output, `> ${input}`, ...result.output],
      );
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
