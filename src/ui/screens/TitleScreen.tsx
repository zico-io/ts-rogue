import { Box, Text } from "ink";
import pkg from "../../../package.json";
import { CLASSES } from "../../data/classes";
import { theme } from "../theme";

/** Block-letter logo, one gradient color per row (see `theme.logoGradient`). */
const LOGO = [
  "█████  ████       ████   ███   ████ █   █ █████",
  "  █   █           █   █ █   █ █     █   █ █",
  "  █    ███   ███  ████  █   █ █  ██ █   █ ███",
  "  █       █       █  █  █   █ █   █ █   █ █",
  "  █   ████        █   █  ███   ███   ███  █████",
];

export interface TitleScreenProps {
  hasSave: boolean;
  /** Title flow phase: pick a class, then pick a mode (ROG-17 class choice). */
  titlePhase: "class" | "mode";
  /** Selected class index into `CLASSES` during the class phase. */
  classCursor: number;
  /** Selected mode index during the mode phase (0 = Normal, 1 = Permadeath). */
  modeCursor: number;
}

function Logo() {
  return (
    <Box flexDirection="column">
      {LOGO.map((line, index) => (
        <Text bold color={theme.logoGradient[index]} key={line}>
          {line}
        </Text>
      ))}
      <Text color={theme.textMuted}>A terminal dungeon crawler.</Text>
    </Box>
  );
}

function VersionFooter() {
  return <Text color={theme.textFaint}>v{pkg.version}</Text>;
}

/**
 * Shown before a run starts. When a save exists, it prompts to continue. When
 * there is no save, it walks a two-step choice (Phase 6, ROG-12 mode plus
 * ROG-17 class): first a class iterated from the `CLASSES` table, then a mode
 * (Normal - revive at village on defeat, or Permadeath - one life, one run).
 * Input is handled by `app.tsx`; this is a pure display component.
 */
export function TitleScreen({
  hasSave,
  titlePhase,
  classCursor,
  modeCursor,
}: TitleScreenProps) {
  if (hasSave) {
    return (
      <Box flexDirection="column" gap={1} paddingY={1}>
        <Logo />
        <Text>Press any key to continue, q to quit.</Text>
        <VersionFooter />
      </Box>
    );
  }

  if (titlePhase === "class") {
    return (
      <Box flexDirection="column" gap={1} paddingY={1}>
        <Logo />
        <Text>Choose your class:</Text>
        <Box flexDirection="column">
          {CLASSES.map((cls, index) => (
            <Text
              key={cls.id}
              color={index === classCursor ? theme.accent : undefined}
            >
              {index === classCursor ? "> " : "  "}
              {cls.name} - {cls.description}
            </Text>
          ))}
        </Box>
        <Text color={theme.textMuted}>
          Up/Down to choose, Enter to continue, q to quit.
        </Text>
        <VersionFooter />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" gap={1} paddingY={1}>
      <Logo />
      <Text>Choose your mode:</Text>
      <Box flexDirection="column">
        <Text color={modeCursor === 0 ? theme.accent : undefined}>
          {modeCursor === 0 ? "> " : "  "}Normal - revive at the village on
          defeat
        </Text>
        <Text color={modeCursor === 1 ? theme.accent : undefined}>
          {modeCursor === 1 ? "> " : "  "}Permadeath - one life, one run
        </Text>
      </Box>
      <Text color={theme.textMuted}>
        Up/Down to choose, Enter to start, Esc for class, q to quit.
      </Text>
      <VersionFooter />
    </Box>
  );
}
