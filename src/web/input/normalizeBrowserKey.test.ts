import { describe, expect, it } from "vitest";
import { normalizeBrowserKey } from "./normalizeBrowserKey";

function key(
  k: string,
  overrides: { ctrlKey?: boolean; metaKey?: boolean } = {},
) {
  return { key: k, ctrlKey: false, metaKey: false, ...overrides };
}

describe("normalizeBrowserKey", () => {
  it("maps Ctrl+C to ctrl+c", () => {
    expect(normalizeBrowserKey(key("c", { ctrlKey: true }))).toBe("ctrl+c");
  });

  it("drops other ctrl/meta-modified keys", () => {
    expect(normalizeBrowserKey(key("a", { ctrlKey: true }))).toBeUndefined();
    expect(normalizeBrowserKey(key("a", { metaKey: true }))).toBeUndefined();
    expect(
      normalizeBrowserKey(key("ArrowUp", { ctrlKey: true })),
    ).toBeUndefined();
  });

  it("maps arrow keys", () => {
    expect(normalizeBrowserKey(key("ArrowUp"))).toBe("up");
    expect(normalizeBrowserKey(key("ArrowDown"))).toBe("down");
    expect(normalizeBrowserKey(key("ArrowLeft"))).toBe("left");
    expect(normalizeBrowserKey(key("ArrowRight"))).toBe("right");
  });

  it("maps Enter/Escape/Backspace/Delete/Tab", () => {
    expect(normalizeBrowserKey(key("Enter"))).toBe("enter");
    expect(normalizeBrowserKey(key("Escape"))).toBe("escape");
    expect(normalizeBrowserKey(key("Backspace"))).toBe("backspace");
    expect(normalizeBrowserKey(key("Delete"))).toBe("backspace");
    expect(normalizeBrowserKey(key("Tab"))).toBe("tab");
  });

  it("maps backtick and q as literal keys", () => {
    expect(normalizeBrowserKey(key("`"))).toBe("`");
    expect(normalizeBrowserKey(key("q"))).toBe("q");
  });

  it("maps h/j/k/l as literal keys", () => {
    expect(normalizeBrowserKey(key("h"))).toBe("h");
    expect(normalizeBrowserKey(key("j"))).toBe("j");
    expect(normalizeBrowserKey(key("k"))).toBe("k");
    expect(normalizeBrowserKey(key("l"))).toBe("l");
  });

  it("maps single digits to digit:<n>", () => {
    expect(normalizeBrowserKey(key("1"))).toBe("digit:1");
    expect(normalizeBrowserKey(key("4"))).toBe("digit:4");
  });

  it("maps other single printable characters to char:<c>", () => {
    expect(normalizeBrowserKey(key("b"))).toBe("char:b");
    expect(normalizeBrowserKey(key(">"))).toBe("char:>");
    expect(normalizeBrowserKey(key("<"))).toBe("char:<");
  });

  it("drops multi-character non-special keys (Shift, Control, F-keys)", () => {
    expect(normalizeBrowserKey(key("Shift"))).toBeUndefined();
    expect(normalizeBrowserKey(key("Control"))).toBeUndefined();
    expect(normalizeBrowserKey(key("F1"))).toBeUndefined();
    expect(normalizeBrowserKey(key("CapsLock"))).toBeUndefined();
  });
});
