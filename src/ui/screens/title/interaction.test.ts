import { describe, expect, it } from "vitest";
import { CLASSES } from "../../../data/classes";
import { MAX_NAME_LENGTH } from "../TitleScreen";
import {
  reduceTitleUi,
  type TitleUiContext,
  type TitleUiState,
} from "./interaction";

const ctx: TitleUiContext = {
  hasSave: true,
  defaultPermadeath: false,
  defaultHeroName: "Hero",
};

function menuState(overrides: Partial<TitleUiState> = {}): TitleUiState {
  return {
    view: "menu",
    menuCursor: 0,
    classCursor: 0,
    modeCursor: 0,
    nameInput: "",
    ...overrides,
  };
}

describe("reduceTitleUi - menu view", () => {
  it("wraps menuDown past the last option (hasSave: true, 4 options)", () => {
    const state = menuState({ menuCursor: 3 });
    const result = reduceTitleUi(state, { kind: "menuDown" }, ctx);
    expect(result.state.menuCursor).toBe(0);
  });

  it("wraps menuUp past the first option (hasSave: true, 4 options)", () => {
    const state = menuState({ menuCursor: 0 });
    const result = reduceTitleUi(state, { kind: "menuUp" }, ctx);
    expect(result.state.menuCursor).toBe(3);
  });

  it("wraps menuDown past the last option (hasSave: false, 3 options)", () => {
    const noSave: TitleUiContext = { ...ctx, hasSave: false };
    const state = menuState({ menuCursor: 2 });
    const result = reduceTitleUi(state, { kind: "menuDown" }, noSave);
    expect(result.state.menuCursor).toBe(0);
  });

  it("wraps menuUp past the first option (hasSave: false, 3 options)", () => {
    const noSave: TitleUiContext = { ...ctx, hasSave: false };
    const state = menuState({ menuCursor: 0 });
    const result = reduceTitleUi(state, { kind: "menuUp" }, noSave);
    expect(result.state.menuCursor).toBe(2);
  });

  it("selecting New Game moves to the class view with classCursor reset", () => {
    const state = menuState({ menuCursor: 0, classCursor: 2 });
    const result = reduceTitleUi(state, { kind: "confirm" }, ctx);
    expect(result.state.view).toBe("class");
    expect(result.state.classCursor).toBe(0);
    expect(result.effect).toBeUndefined();
  });

  it("selecting Continue produces a continueGame effect", () => {
    const state = menuState({ menuCursor: 1 });
    const result = reduceTitleUi(state, { kind: "confirm" }, ctx);
    expect(result.effect).toEqual({ type: "continueGame" });
  });

  it("selecting Settings produces an openSettings effect", () => {
    const state = menuState({ menuCursor: 2 });
    const result = reduceTitleUi(state, { kind: "confirm" }, ctx);
    expect(result.effect).toEqual({ type: "openSettings" });
  });

  it("selecting Quit produces a quit effect", () => {
    const state = menuState({ menuCursor: 3 });
    const result = reduceTitleUi(state, { kind: "confirm" }, ctx);
    expect(result.effect).toEqual({ type: "quit" });
  });
});

describe("reduceTitleUi - class view", () => {
  function classState(overrides: Partial<TitleUiState> = {}): TitleUiState {
    return { ...menuState(overrides), view: "class", ...overrides };
  }

  it("Escape returns to the menu view", () => {
    const result = reduceTitleUi(classState(), { kind: "cancel" }, ctx);
    expect(result.state.view).toBe("menu");
  });

  it("wraps classCursor down past the last class", () => {
    const state = classState({ classCursor: CLASSES.length - 1 });
    const result = reduceTitleUi(state, { kind: "menuDown" }, ctx);
    expect(result.state.classCursor).toBe(0);
  });

  it("wraps classCursor up past the first class", () => {
    const state = classState({ classCursor: 0 });
    const result = reduceTitleUi(state, { kind: "menuUp" }, ctx);
    expect(result.state.classCursor).toBe(CLASSES.length - 1);
  });

  it("Enter moves to the mode view seeded from ctx.defaultPermadeath", () => {
    const result = reduceTitleUi(
      classState(),
      { kind: "confirm" },
      { ...ctx, defaultPermadeath: true },
    );
    expect(result.state.view).toBe("mode");
    expect(result.state.modeCursor).toBe(1);
  });

  it("Enter seeds modeCursor to 0 when ctx.defaultPermadeath is false", () => {
    const result = reduceTitleUi(
      classState(),
      { kind: "confirm" },
      { ...ctx, defaultPermadeath: false },
    );
    expect(result.state.modeCursor).toBe(0);
  });
});

describe("reduceTitleUi - mode view", () => {
  function modeState(overrides: Partial<TitleUiState> = {}): TitleUiState {
    return { ...menuState(overrides), view: "mode", ...overrides };
  }

  it("menuUp toggles modeCursor from 0 to 1", () => {
    const result = reduceTitleUi(
      modeState({ modeCursor: 0 }),
      { kind: "menuUp" },
      ctx,
    );
    expect(result.state.modeCursor).toBe(1);
  });

  it("menuDown toggles modeCursor from 1 to 0", () => {
    const result = reduceTitleUi(
      modeState({ modeCursor: 1 }),
      { kind: "menuDown" },
      ctx,
    );
    expect(result.state.modeCursor).toBe(0);
  });

  it("Escape returns to the class view", () => {
    const result = reduceTitleUi(modeState(), { kind: "cancel" }, ctx);
    expect(result.state.view).toBe("class");
  });

  it("Enter moves to the name view seeded from ctx.defaultHeroName", () => {
    const result = reduceTitleUi(
      modeState(),
      { kind: "confirm" },
      { ...ctx, defaultHeroName: "Zed" },
    );
    expect(result.state.view).toBe("name");
    expect(result.state.nameInput).toBe("Zed");
  });
});

describe("reduceTitleUi - name view", () => {
  function nameState(overrides: Partial<TitleUiState> = {}): TitleUiState {
    return { ...menuState(overrides), view: "name", ...overrides };
  }

  it("typing appends a character to nameInput", () => {
    const result = reduceTitleUi(
      nameState({ nameInput: "Ab" }),
      { kind: "type", char: "c" },
      ctx,
    );
    expect(result.state.nameInput).toBe("Abc");
  });

  it("typing stops appending once MAX_NAME_LENGTH is reached", () => {
    const full = "x".repeat(MAX_NAME_LENGTH);
    const result = reduceTitleUi(
      nameState({ nameInput: full }),
      { kind: "type", char: "y" },
      ctx,
    );
    expect(result.state.nameInput).toBe(full);
  });

  it("backspace removes the last character", () => {
    const result = reduceTitleUi(
      nameState({ nameInput: "Abc" }),
      { kind: "backspace" },
      ctx,
    );
    expect(result.state.nameInput).toBe("Ab");
  });

  it("Escape returns to the mode view", () => {
    const result = reduceTitleUi(nameState(), { kind: "cancel" }, ctx);
    expect(result.state.view).toBe("mode");
  });

  it("Enter with a non-blank trimmed name starts a new game", () => {
    const state = nameState({
      nameInput: "  Rin  ",
      classCursor: 1,
      modeCursor: 1,
    });
    const result = reduceTitleUi(state, { kind: "confirm" }, ctx);
    expect(result.effect).toEqual({
      type: "startNewGame",
      classId: CLASSES[1].id,
      permadeath: true,
      name: "Rin",
    });
  });

  it("Enter with a blank/whitespace-only name is a no-op", () => {
    const state = nameState({ nameInput: "   " });
    const result = reduceTitleUi(state, { kind: "confirm" }, ctx);
    expect(result.effect).toBeUndefined();
    expect(result.state).toEqual(state);
  });

  it("ctrl+c quits from the name view", () => {
    const result = reduceTitleUi(nameState(), { kind: "quit" }, ctx);
    expect(result.effect).toEqual({ type: "quit" });
  });
});

describe("reduceTitleUi - quit from every view", () => {
  it("quits from the menu view", () => {
    expect(reduceTitleUi(menuState(), { kind: "quit" }, ctx).effect).toEqual({
      type: "quit",
    });
  });

  it("quits from the class view", () => {
    const state: TitleUiState = { ...menuState(), view: "class" };
    expect(reduceTitleUi(state, { kind: "quit" }, ctx).effect).toEqual({
      type: "quit",
    });
  });

  it("quits from the mode view", () => {
    const state: TitleUiState = { ...menuState(), view: "mode" };
    expect(reduceTitleUi(state, { kind: "quit" }, ctx).effect).toEqual({
      type: "quit",
    });
  });
});
