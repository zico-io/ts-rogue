import { describe, expect, it } from "vitest";
import { newGame } from "../../engine/state/store";
import { entry } from "../../engine/state/types";
import { buildChrome } from "./chrome";
import type { LogNode, MeterNode, StackNode, TextNode } from "./tree";

describe("buildChrome", () => {
  it("sizes the content region from the panel overhead and footer rows", () => {
    const state = newGame(1);
    const { content } = buildChrome(
      state,
      { width: 80, height: 24 },
      { title: "Village" },
    );
    // width: 80 - 4 (border/padding overhead) = 76
    expect(content.width).toBe(76);
    // height: 24 - 2 (panel overhead) - 2 (1 member + gold row) - logBox
    // logLines = clamp(round(24*0.22), 3, 8) = clamp(5,3,8) = 5; logBox = 7
    expect(content.height).toBe(24 - 2 - 2 - 7);
  });

  it("omits the log box and its height when showLog is false", () => {
    const state = newGame(1);
    const withLog = buildChrome(
      state,
      { width: 80, height: 24 },
      { title: "Battle" },
    );
    const withoutLog = buildChrome(
      state,
      { width: 80, height: 24 },
      { title: "Battle", showLog: false },
    );
    expect(withoutLog.content.height).toBeGreaterThan(withLog.content.height);
    const logNode = withoutLog.panel.children.find(
      (child) => child.kind === "log",
    );
    expect(logNode).toBeUndefined();
  });

  it("accounts for hint line wrapping in the content height", () => {
    const state = newGame(1);
    const noHint = buildChrome(
      state,
      { width: 80, height: 24 },
      { title: "Overworld" },
    );
    const withHint = buildChrome(
      state,
      { width: 80, height: 24 },
      { title: "Overworld", hint: "Arrows/HJKL move · Q quit" },
    );
    expect(withHint.content.height).toBe(noHint.content.height - 1);
    const hintNode = withHint.panel.children.find(
      (child) => child.kind === "text" && child.key === "chrome-hint",
    ) as TextNode | undefined;
    expect(hintNode?.text).toBe("Arrows/HJKL move · Q quit");
  });

  it("builds one footer row per party member plus a gold line", () => {
    const state = newGame(1);
    const withRecruit = {
      ...state,
      party: [
        ...state.party,
        { ...state.party[0], id: "hero-2", name: "Ally" },
      ],
    };
    const { panel } = buildChrome(
      withRecruit,
      { width: 80, height: 24 },
      { title: "Village" },
    );
    const footer = panel.children.find(
      (child) => child.key === "chrome-footer",
    ) as StackNode;
    // 2 party rows + 1 gold line
    expect(footer.children).toHaveLength(3);
    expect(footer.children[0].key).toBe(
      `chrome-party-${withRecruit.party[0].id}`,
    );
    expect(footer.children[1].key).toBe(
      `chrome-party-${withRecruit.party[1].id}`,
    );
    const gold = footer.children[2] as TextNode;
    expect(gold.text).toBe(`Gold ${withRecruit.gold}`);
  });

  it("colors HP/MP meters and values by the same hpColor/mpColor thresholds", () => {
    const state = newGame(1);
    const hurt = {
      ...state,
      party: [{ ...state.party[0], hp: 1, maxHp: 10 }],
    };
    const { panel } = buildChrome(
      hurt,
      { width: 80, height: 24 },
      { title: "Village" },
    );
    const footer = panel.children.find(
      (child) => child.key === "chrome-footer",
    ) as StackNode;
    const row = footer.children[0] as StackNode;
    const meter = row.children.find(
      (child) => child.kind === "meter" && child.key.endsWith("-hp-meter"),
    ) as MeterNode;
    expect(meter.value).toBe(1);
    expect(meter.max).toBe(10);
    // critical (<=0.25) HP reads danger red
    expect(meter.color).toBe("#e74343");
  });

  it("caps the log to a clamped fraction of the available height", () => {
    const state = newGame(1);
    const tiny = buildChrome(
      state,
      { width: 80, height: 10 },
      { title: "Village" },
    );
    const tinyLog = tiny.panel.children.find((child) => child.kind === "log") as
      | LogNode
      | undefined;
    expect(tinyLog?.maxLines).toBe(3); // clamp(round(10*0.22)=2, 3, 8) -> 3

    const huge = buildChrome(
      state,
      { width: 80, height: 100 },
      { title: "Village" },
    );
    const hugeLog = huge.panel.children.find((child) => child.kind === "log") as
      | LogNode
      | undefined;
    expect(hugeLog?.maxLines).toBe(8); // clamp(round(100*0.22)=22, 3, 8) -> 8
  });

  it("reads the log node's messages from state.log", () => {
    const state = newGame(1);
    const withLog = {
      ...state,
      log: [entry("Something happened", "system"), entry("Ouch", "damage")],
    };
    const { panel } = buildChrome(
      withLog,
      { width: 80, height: 24 },
      { title: "Village" },
    );
    const logNode = panel.children.find(
      (child) => child.kind === "log",
    ) as LogNode;
    expect(logNode.messages).toEqual(withLog.log);
  });

  it("never returns a content height below 1 even when the footer overflows the size", () => {
    const state = newGame(1);
    const { content } = buildChrome(
      state,
      { width: 10, height: 3 },
      { title: "X" },
    );
    expect(content.height).toBeGreaterThanOrEqual(1);
  });

  it("sets the panel title and a stable panel key", () => {
    const state = newGame(1);
    const { panel } = buildChrome(
      state,
      { width: 80, height: 24 },
      { title: "Dungeon" },
    );
    expect(panel.title).toBe("Dungeon");
    expect(panel.key).toBe("chrome-panel");
    expect(panel.kind).toBe("panel");
  });

  it("keys party rows and meters by member id so interpreters can key their draw objects", () => {
    const state = newGame(1);
    const { panel } = buildChrome(
      state,
      { width: 80, height: 24 },
      { title: "Village" },
    );
    const footer = panel.children.find(
      (child) => child.key === "chrome-footer",
    ) as StackNode;
    const row = footer.children[0] as StackNode;
    const id = state.party[0].id;
    expect(row.key).toBe(`chrome-party-${id}`);
    for (const child of row.children) {
      expect(child.key.startsWith(`chrome-party-${id}-`)).toBe(true);
    }
  });
});
