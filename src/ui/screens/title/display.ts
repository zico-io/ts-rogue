export const LOGO = [
  "█████  ████       ████   ███   ████ █   █ █████",
  "  █   █           █   █ █   █ █     █   █ █",
  "  █    ███   ███  ████  █   █ █  ██ █   █ ███",
  "  █       █       █  █  █   █ █   █ █   █ █",
  "  █   ████        █   █  ███   ███   ███  █████",
];

export type TitleView = "menu" | "class" | "mode" | "name" | "settings";

export interface MenuOption {
  id: "new" | "continue" | "settings" | "quit";
  label: string;
}

export function mainMenuOptions(hasSave: boolean): readonly MenuOption[] {
  return [
    { id: "new", label: "New Game" },
    ...(hasSave ? ([{ id: "continue", label: "Continue" }] as const) : []),
    { id: "settings", label: "Settings" },
    { id: "quit", label: "Quit" },
  ];
}

export const MAX_NAME_LENGTH = 12;
