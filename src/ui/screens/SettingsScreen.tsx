import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { GameSettings } from "../../persistence/settings";
import { theme } from "../theme";
import { MAX_NAME_LENGTH } from "./TitleScreen";

export interface SettingsScreenProps {
  settings: GameSettings;
  hasSave: boolean;

  onUpdate: (next: GameSettings) => void;

  onDeleteSave: () => void;

  onClose: () => void;
}

type Row = "permadeath" | "name" | "seed" | "delete" | "back";
const ROWS: readonly Row[] = ["permadeath", "name", "seed", "delete", "back"];

type Editing = "none" | "name" | "seed" | "confirmDelete";

export function SettingsScreen({
  settings,
  hasSave,
  onUpdate,
  onDeleteSave,
  onClose,
}: SettingsScreenProps) {
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState<Editing>("none");
  const [buffer, setBuffer] = useState("");

  const commit = (edit: Editing) => {
    if (edit === "name") {
      onUpdate({ ...settings, defaultHeroName: buffer.trim() || "Hero" });
    } else if (edit === "seed") {
      const seed = buffer.trim() === "" ? null : Number(buffer);
      onUpdate({
        ...settings,
        customSeed: Number.isFinite(seed) ? seed : null,
      });
    }
    setEditing("none");
  };

  useInput((character, key) => {
    if (editing === "name" || editing === "seed") {
      if (key.return) {
        commit(editing);
      } else if (key.escape) {
        setEditing("none");
      } else if (key.backspace || key.delete) {
        setBuffer((value) => value.slice(0, -1));
      } else if (editing === "name") {
        if (
          character &&
          !key.ctrl &&
          !key.meta &&
          buffer.length < MAX_NAME_LENGTH
        )
          setBuffer((value) => value + character);
      } else if (/^[0-9]$/.test(character)) {
        setBuffer((value) => value + character);
      }
      return;
    }

    if (editing === "confirmDelete") {
      if (character === "y") {
        onDeleteSave();
        setEditing("none");
      } else if (character === "n" || key.escape) {
        setEditing("none");
      }
      return;
    }

    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow) {
      setCursor((c) => (c + ROWS.length - 1) % ROWS.length);
      return;
    }
    if (key.downArrow) {
      setCursor((c) => (c + 1) % ROWS.length);
      return;
    }
    const row = ROWS[cursor];
    if (
      row === "permadeath" &&
      (key.return || key.leftArrow || key.rightArrow)
    ) {
      onUpdate({ ...settings, defaultPermadeath: !settings.defaultPermadeath });
    } else if (key.return) {
      if (row === "name") {
        setBuffer(settings.defaultHeroName);
        setEditing("name");
      } else if (row === "seed") {
        setBuffer(settings.customSeed?.toString() ?? "");
        setEditing("seed");
      } else if (row === "delete") {
        if (hasSave) setEditing("confirmDelete");
      } else if (row === "back") {
        onClose();
      }
    }
  });

  const value = (row: Row): string => {
    switch (row) {
      case "permadeath":
        return settings.defaultPermadeath ? "On" : "Off";
      case "name":
        return editing === "name" ? `${buffer}_` : settings.defaultHeroName;
      case "seed":
        return editing === "seed"
          ? `${buffer}_`
          : (settings.customSeed?.toString() ?? "none");
      case "delete":
        return hasSave ? "" : "(no save)";
      case "back":
        return "";
    }
  };

  const label: Record<Row, string> = {
    permadeath: "Default permadeath",
    name: "Default hero name",
    seed: "Custom run seed",
    delete: "Delete saved game",
    back: "Back",
  };

  return (
    <Box flexDirection="column" gap={1} paddingY={1} alignItems="center">
      <Text bold color={theme.title}>
        Settings
      </Text>
      <Box flexDirection="column">
        {ROWS.map((row, index) => {
          const active = index === cursor;
          const disabled = row === "delete" && !hasSave;
          const shown = value(row);
          return (
            <Text
              key={row}
              color={
                active ? theme.accent : disabled ? theme.textFaint : undefined
              }
            >
              {active ? "> " : "  "}
              {label[row]}
              {shown ? `: ${shown}` : ""}
            </Text>
          );
        })}
      </Box>
      <Text color={theme.textMuted}>
        {editing === "confirmDelete"
          ? "Delete the saved game? y/n"
          : editing === "none"
            ? "Up/Down to move, Enter to change, Esc to go back."
            : "Type to edit, Enter to save, Esc to cancel."}
      </Text>
    </Box>
  );
}
