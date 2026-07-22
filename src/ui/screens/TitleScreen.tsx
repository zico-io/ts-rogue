import { Box, Text } from "ink";
import type { ReactNode } from "react";
import pkg from "../../../package.json";
import { CLASSES } from "../../data/classes";
import { theme } from "../theme";
import {
  LOGO,
  MAX_NAME_LENGTH,
  type MenuOption,
  mainMenuOptions,
  type TitleView,
} from "./title/display";

export type { MenuOption, TitleView };
// Re-exported so existing importers (`SettingsScreen.tsx`,
// `title/interaction.test.ts`) don't need to change paths; the canonical
// home for this pure data is `./title/display` (see that file's doc
// comment for why it's split out).
export { LOGO, MAX_NAME_LENGTH, mainMenuOptions };

export interface TitleScreenProps {
  titleView: Exclude<TitleView, "settings">;
  hasSave: boolean;
  /** Selected main-menu index into `mainMenuOptions(hasSave)`. */
  menuCursor: number;
  /** Selected class index into `CLASSES` during the class view. */
  classCursor: number;
  /** Selected mode index during the mode view (0 = Normal, 1 = Permadeath). */
  modeCursor: number;
  /** Current hero-name buffer during the name view. */
  nameInput: string;
}

function Logo() {
  return (
    <Box flexDirection="column" alignItems="center">
      {/* The block-letter rows must share one left origin or the columns of the
          art drift apart; center the whole block, never the rows individually. */}
      <Box flexDirection="column">
        {LOGO.map((line, index) => (
          <Text bold color={theme.logoGradient[index]} key={line}>
            {line}
          </Text>
        ))}
      </Box>
      <Text color={theme.textMuted}>A terminal dungeon crawler.</Text>
    </Box>
  );
}

function VersionFooter() {
  return <Text color={theme.textFaint}>v{pkg.version}</Text>;
}

function Cursor({ selected }: { selected: boolean }) {
  return <>{selected ? "> " : "  "}</>;
}

/**
 * Shown before a run starts. Landing view is a main menu (New Game / Continue /
 * Settings / Quit). New Game walks a class -> mode -> name flow before the run
 * begins. Input is handled by `app.tsx`; this is a pure display component
 * (Settings is a separate `SettingsScreen`).
 */
export function TitleScreen({
  titleView,
  hasSave,
  menuCursor,
  classCursor,
  modeCursor,
  nameInput,
}: TitleScreenProps) {
  let body: ReactNode;

  if (titleView === "menu") {
    const options = mainMenuOptions(hasSave);
    body = (
      <>
        <Box flexDirection="column">
          {options.map((option, index) => (
            <Text
              key={option.id}
              color={index === menuCursor ? theme.accent : undefined}
            >
              <Cursor selected={index === menuCursor} />
              {option.label}
            </Text>
          ))}
        </Box>
        <Text color={theme.textMuted}>Up/Down to choose, Enter to select.</Text>
      </>
    );
  } else if (titleView === "class") {
    body = (
      <>
        <Text>Choose your class:</Text>
        <Box flexDirection="column">
          {CLASSES.map((cls, index) => (
            <Text
              key={cls.id}
              color={index === classCursor ? theme.accent : undefined}
            >
              <Cursor selected={index === classCursor} />
              {cls.name} - {cls.description}
            </Text>
          ))}
        </Box>
        <Text color={theme.textMuted}>
          Up/Down to choose, Enter to continue, Esc to go back.
        </Text>
      </>
    );
  } else if (titleView === "mode") {
    body = (
      <>
        <Text>Choose your mode:</Text>
        <Box flexDirection="column">
          <Text color={modeCursor === 0 ? theme.accent : undefined}>
            <Cursor selected={modeCursor === 0} />
            Normal - revive at the village on defeat
          </Text>
          <Text color={modeCursor === 1 ? theme.accent : undefined}>
            <Cursor selected={modeCursor === 1} />
            Permadeath - one life, one run
          </Text>
        </Box>
        <Text color={theme.textMuted}>
          Up/Down to choose, Enter to continue, Esc to go back.
        </Text>
      </>
    );
  } else {
    // name
    body = (
      <>
        <Text>Name your hero:</Text>
        <Text color={theme.accent}>
          &gt; {nameInput}
          <Text color={theme.textFaint}>_</Text>
        </Text>
        <Text color={theme.textMuted}>
          Type a name, Enter to start, Esc to go back.
        </Text>
      </>
    );
  }

  return (
    <Box flexDirection="column" gap={1} paddingY={1} alignItems="center">
      <Logo />
      {body}
      <VersionFooter />
    </Box>
  );
}
