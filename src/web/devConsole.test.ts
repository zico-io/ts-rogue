import { describe, expect, it, vi } from "vitest";
import { GameStore, newGame } from "../engine/state/store";
import { BrowserDevConsole } from "./devConsole";

function key(k: string) {
  return { key: k, ctrlKey: false, metaKey: false };
}

describe("BrowserDevConsole", () => {
  it("toggles open/closed on backtick", () => {
    const store = new GameStore(newGame(1));
    const devConsole = new BrowserDevConsole(store, { crash: vi.fn() });

    expect(devConsole.isOpen()).toBe(false);
    devConsole.handleKeyDown(key("`"));
    expect(devConsole.isOpen()).toBe(true);
    devConsole.handleKeyDown(key("`"));
    expect(devConsole.isOpen()).toBe(false);
  });

  it("accumulates typed characters and supports backspace", () => {
    const store = new GameStore(newGame(1));
    const devConsole = new BrowserDevConsole(store, { crash: vi.fn() });

    for (const char of "help") devConsole.handleKeyDown(key(char));
    expect(devConsole.getInput()).toBe("help");

    devConsole.handleKeyDown(key("Backspace"));
    expect(devConsole.getInput()).toBe("hel");
  });

  it("runs a command on Enter via the shared runDevCommand interpreter", () => {
    const store = new GameStore(newGame(1));
    const devConsole = new BrowserDevConsole(store, { crash: vi.fn() });

    for (const char of "scene overworld") devConsole.handleKeyDown(key(char));
    devConsole.handleKeyDown(key("Enter"));

    expect(store.getState().scene).toBe("overworld");
    expect(devConsole.getInput()).toBe("");
    expect(devConsole.getOutput()).toEqual([
      "> scene overworld",
      "Scene changed to overworld",
    ]);
  });

  it("stashes Linear issue filing instead of touching Node-only I/O", () => {
    const store = new GameStore(newGame(1));
    const devConsole = new BrowserDevConsole(store, { crash: vi.fn() });

    for (const char of "bug something broke")
      devConsole.handleKeyDown(key(char));
    devConsole.handleKeyDown(key("Enter"));

    expect(devConsole.getOutput()).toContain(
      "Issue filing isn't available in the browser yet.",
    );
  });

  it("routes the crash command to the handler and to a fatal incident with a journal entry", () => {
    const store = new GameStore(newGame(1));
    const crash = vi.fn((message: string) =>
      store.reportFailure("manual", new Error(message), true),
    );
    const devConsole = new BrowserDevConsole(store, { crash });
    const incidents: string[] = [];
    store.subscribeIncidents((incident) => incidents.push(incident.message));

    for (const char of "crash synthetic failure") {
      devConsole.handleKeyDown(key(char));
    }
    devConsole.handleKeyDown(key("Enter"));

    expect(crash).toHaveBeenCalledWith("synthetic failure");
    expect(incidents).toEqual(["synthetic failure"]);
    expect(store.getDebugJournal().at(-1)).toMatchObject({
      kind: "failure",
      message: "synthetic failure",
    });
  });
});
