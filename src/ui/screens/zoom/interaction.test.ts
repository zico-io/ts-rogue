import { describe, expect, it } from "vitest";
import { reduceZoomUi, resolveZoomIntent } from "./interaction";

describe("resolveZoomIntent", () => {
  it("maps up/down to menuUp/menuDown, enter to confirm, escape to cancel", () => {
    expect(resolveZoomIntent("up")).toEqual({ kind: "menuUp" });
    expect(resolveZoomIntent("down")).toEqual({ kind: "menuDown" });
    expect(resolveZoomIntent("enter")).toEqual({ kind: "confirm" });
    expect(resolveZoomIntent("escape")).toEqual({ kind: "cancel" });
  });

  it("ignores unbound keys", () => {
    expect(resolveZoomIntent("tab")).toBeUndefined();
    expect(resolveZoomIntent("char:z")).toBeUndefined();
  });
});

describe("reduceZoomUi", () => {
  it("wraps the cursor down and up modulo the waypoint count", () => {
    const ctx = { count: 3 };
    expect(
      reduceZoomUi({ cursor: 0 }, { kind: "menuDown" }, ctx).state,
    ).toEqual({ cursor: 1 });
    expect(
      reduceZoomUi({ cursor: 2 }, { kind: "menuDown" }, ctx).state,
    ).toEqual({ cursor: 0 });
    expect(reduceZoomUi({ cursor: 0 }, { kind: "menuUp" }, ctx).state).toEqual({
      cursor: 2,
    });
  });

  it("confirm emits a travel effect at the current cursor index", () => {
    const result = reduceZoomUi(
      { cursor: 1 },
      { kind: "confirm" },
      {
        count: 3,
      },
    );
    expect(result.effect).toEqual({ type: "travel", index: 1 });
    expect(result.state).toEqual({ cursor: 1 });
  });

  it("cancel emits a close effect", () => {
    const result = reduceZoomUi(
      { cursor: 0 },
      { kind: "cancel" },
      {
        count: 3,
      },
    );
    expect(result.effect).toEqual({ type: "close" });
  });

  it("guards against a zero waypoint count: only cancel/close works, no cursor moves", () => {
    const ctx = { count: 0 };
    expect(
      reduceZoomUi({ cursor: 0 }, { kind: "menuDown" }, ctx).state,
    ).toEqual({ cursor: 0 });
    expect(
      reduceZoomUi({ cursor: 0 }, { kind: "confirm" }, ctx).effect,
    ).toBeUndefined();
    expect(reduceZoomUi({ cursor: 0 }, { kind: "cancel" }, ctx).effect).toEqual(
      { type: "close" },
    );
  });

  it("is a no-op for an unrelated intent", () => {
    const result = reduceZoomUi(
      { cursor: 0 },
      { kind: "toggleConsole" },
      {
        count: 3,
      },
    );
    expect(result.effect).toBeUndefined();
    expect(result.state).toEqual({ cursor: 0 });
  });
});
