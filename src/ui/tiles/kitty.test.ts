import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasTile,
  initSequence,
  SPRITE_CELLS,
  spriteRows,
  tileText,
  tmuxWrap,
} from "./kitty";

const ESC = "\x1b";
const PH = "\u{10EEEE}";
const D = ["̅", "̍", "̎", "̐", "̒", "̽", "̾", "̿"];

describe("tileText", () => {
  it("emits image-id fg, placement-id underline, and a 2-cell row-0 run", () => {
    // grass is the first registry entry -> image id 1, placement always 1
    expect(tileText("grass")).toBe(
      `${ESC}[38;5;1m${ESC}[58;5;1m${PH}${D[0]}${D[0]}${PH}${D[0]}${D[1]}${ESC}[59;39m`,
    );
  });
});

describe("spriteRows", () => {
  it("emits one self-contained run per sprite row", () => {
    const rows = spriteRows("slime"); // registry position 13 -> image id 13
    expect(rows).toHaveLength(SPRITE_CELLS.height);
    const cells = Array.from(
      { length: SPRITE_CELLS.width },
      (_, col) => `${PH}${D[1]}${D[col]}`,
    ).join("");
    expect(rows[1]).toBe(`${ESC}[38;5;13m${ESC}[58;5;1m${cells}${ESC}[59;39m`);
  });
});

describe("initSequence", () => {
  it("transmits each tile as direct chunks under its own image id", () => {
    const big = "A".repeat(4096 + 100);
    const sequence = initSequence(
      [
        ["grass", big],
        ["slime", "QUJD"],
      ],
      false,
    );
    // first chunk carries the control keys with m=1, the final chunk m=0
    expect(
      sequence.startsWith(
        `${ESC}_Ga=t,f=100,i=1,q=2,m=1;${"A".repeat(4096)}${ESC}\\`,
      ),
    ).toBe(true);
    expect(sequence).toContain(`${ESC}_Gm=0;${"A".repeat(100)}${ESC}\\`);
    // grass placement: image 1, placement 1, 2x1 cells, no source rect
    expect(sequence).toContain(`${ESC}_Ga=p,U=1,q=2,i=1,p=1,c=2,r=1${ESC}\\`);
    // slime: single-chunk transmit (m=0 up front) + sprite-sized placement
    expect(sequence).toContain(`${ESC}_Ga=t,f=100,i=13,q=2,m=0;QUJD${ESC}\\`);
    expect(sequence).toContain(
      `${ESC}_Ga=p,U=1,q=2,i=13,p=1,c=${SPRITE_CELLS.width},r=${SPRITE_CELLS.height}${ESC}\\`,
    );
  });

  it("wraps every command for tmux passthrough when inside tmux", () => {
    const sequence = initSequence([["grass", "QUJD"]], true);
    expect(sequence.startsWith(`${ESC}Ptmux;${ESC}${ESC}_G`)).toBe(true);
    expect(sequence.endsWith(`${ESC}${ESC}\\${ESC}\\`)).toBe(true);
  });
});

describe("tmuxWrap", () => {
  it("doubles every ESC inside the passthrough envelope", () => {
    expect(tmuxWrap(`${ESC}_Gx${ESC}\\`, true)).toBe(
      `${ESC}Ptmux;${ESC}${ESC}_Gx${ESC}${ESC}\\${ESC}\\`,
    );
  });

  it("passes through untouched outside tmux", () => {
    expect(tmuxWrap(`${ESC}_Gx${ESC}\\`, false)).toBe(`${ESC}_Gx${ESC}\\`);
  });
});

describe("hasTile", () => {
  it("recognizes monster ids and rejects unknown names", () => {
    expect(hasTile("slime")).toBe(true);
    expect(hasTile("dungeon-guardian")).toBe(true);
    expect(hasTile("beholder")).toBe(false);
  });
});

describe("tilesSupported", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function freshTilesSupported(): Promise<boolean> {
    vi.resetModules();
    const module = await import("./kitty");
    return module.tilesSupported();
  }

  it("detects Ghostty via GHOSTTY_RESOURCES_DIR", async () => {
    vi.stubEnv("GHOSTTY_RESOURCES_DIR", "/Applications/Ghostty.app");
    vi.stubEnv("TSROGUE_NO_TILES", "");
    expect(await freshTilesSupported()).toBe(true);
  });

  it("is off in a plain terminal", async () => {
    vi.stubEnv("GHOSTTY_RESOURCES_DIR", "");
    vi.stubEnv("KITTY_WINDOW_ID", "");
    vi.stubEnv("TERM", "xterm-256color");
    expect(await freshTilesSupported()).toBe(false);
  });

  it("honors the TSROGUE_NO_TILES kill switch", async () => {
    vi.stubEnv("GHOSTTY_RESOURCES_DIR", "/Applications/Ghostty.app");
    vi.stubEnv("TSROGUE_NO_TILES", "1");
    expect(await freshTilesSupported()).toBe(false);
  });
});
