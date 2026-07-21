import { describe, expect, it } from "vitest";
import { createStartingHero } from "../../../engine/entities/party";
import type { ItemInstance } from "../../../engine/loot/types";
import {
  buildPackEntries,
  INITIAL_STORE_UI_STATE,
  INITIAL_TAVERN_UI_STATE,
  OPTIONS,
  type OverviewUiState,
  reduceChurchUi,
  reduceInnUi,
  reduceOverviewUi,
  reduceStoreUi,
  reduceTavernUi,
  resolveChurchIntent,
  resolveInnIntent,
  resolveOverviewIntent,
  resolveStoreIntent,
  resolveTavernIntent,
  type StoreUiContext,
  type StoreUiState,
  type TavernUiContext,
  type TavernUiState,
} from "./interaction";

function overviewState(
  overrides: Partial<OverviewUiState> = {},
): OverviewUiState {
  return { cursor: 0, ...overrides };
}

function item(overrides: Partial<ItemInstance> = {}): ItemInstance {
  return {
    instanceId: "item-1",
    baseId: "short-sword",
    rarity: "common",
    ilvl: 1,
    prefixes: [],
    suffixes: [],
    implicit: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

describe("resolveOverviewIntent", () => {
  it("maps up/down/enter to menu/confirm intents", () => {
    expect(resolveOverviewIntent("up")).toEqual({ kind: "menuUp" });
    expect(resolveOverviewIntent("down")).toEqual({ kind: "menuDown" });
    expect(resolveOverviewIntent("enter")).toEqual({ kind: "confirm" });
  });

  it("maps i/c/s/t/o to shortcut intents", () => {
    for (const char of ["i", "c", "s", "t", "o"]) {
      expect(resolveOverviewIntent(`char:${char}` as never)).toEqual({
        kind: "shortcut",
        char,
      });
    }
  });
});

describe("reduceOverviewUi", () => {
  it("wraps the cursor up/down over OPTIONS.length", () => {
    const up = reduceOverviewUi(overviewState({ cursor: 0 }), {
      kind: "menuUp",
    });
    expect(up.state.cursor).toBe(OPTIONS.length - 1);

    const down = reduceOverviewUi(
      overviewState({ cursor: OPTIONS.length - 1 }),
      { kind: "menuDown" },
    );
    expect(down.state.cursor).toBe(0);
  });

  it("confirm on a building option emits an enter effect", () => {
    const result = reduceOverviewUi(overviewState({ cursor: 0 }), {
      kind: "confirm",
    });
    expect(result.effect).toEqual({ type: "enter", building: "inn" });
  });

  it("confirm on the overworld option emits a leave effect", () => {
    const overworldIndex = OPTIONS.findIndex((o) => o.key === "overworld");
    const result = reduceOverviewUi(overviewState({ cursor: overworldIndex }), {
      kind: "confirm",
    });
    expect(result.effect).toEqual({ type: "leave" });
  });

  it("a shortcut jumps directly to its option regardless of cursor", () => {
    const result = reduceOverviewUi(overviewState({ cursor: 0 }), {
      kind: "shortcut",
      char: "t",
    });
    expect(result.effect).toEqual({ type: "enter", building: "tavern" });
  });

  it("an unmatched shortcut is a no-op", () => {
    const result = reduceOverviewUi(overviewState(), {
      kind: "shortcut",
      char: "z",
    });
    expect(result.effect).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Inn
// ---------------------------------------------------------------------------

describe("Inn interaction", () => {
  it("resolves enter/escape to confirm/cancel", () => {
    expect(resolveInnIntent("enter")).toEqual({ kind: "confirm" });
    expect(resolveInnIntent("escape")).toEqual({ kind: "cancel" });
  });

  it("confirm produces a rest effect, cancel a back effect", () => {
    expect(reduceInnUi({ kind: "confirm" })).toEqual({ type: "rest" });
    expect(reduceInnUi({ kind: "cancel" })).toEqual({ type: "back" });
  });

  it("an unrelated intent produces no effect", () => {
    expect(reduceInnUi({ kind: "menuUp" })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Church
// ---------------------------------------------------------------------------

describe("Church interaction", () => {
  it("resolves enter/escape to confirm/cancel", () => {
    expect(resolveChurchIntent("enter")).toEqual({ kind: "confirm" });
    expect(resolveChurchIntent("escape")).toEqual({ kind: "cancel" });
  });

  it("confirm produces a save effect, cancel a back effect", () => {
    expect(reduceChurchUi({ kind: "confirm" })).toEqual({ type: "save" });
    expect(reduceChurchUi({ kind: "cancel" })).toEqual({ type: "back" });
  });
});

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

describe("buildPackEntries", () => {
  it("lists the 4 equipment slots then the backpack items", () => {
    const member = createStartingHero();
    const backpack = [item({ instanceId: "a" }), item({ instanceId: "b" })];
    const entries = buildPackEntries(member, backpack);
    expect(entries).toHaveLength(6);
    expect(entries.slice(0, 4).map((e) => e.kind)).toEqual([
      "equipped",
      "equipped",
      "equipped",
      "equipped",
    ]);
    expect(
      entries
        .slice(4)
        .map((e) => (e.kind === "backpack" ? e.item.instanceId : null)),
    ).toEqual(["a", "b"]);
  });
});

function storeCtx(overrides: Partial<StoreUiContext> = {}): StoreUiContext {
  return {
    partyLength: 1,
    memberId: "hero-1",
    packEntries: buildPackEntries(createStartingHero(), []),
    ...overrides,
  };
}

function storeState(overrides: Partial<StoreUiState> = {}): StoreUiState {
  return { ...INITIAL_STORE_UI_STATE, ...overrides };
}

describe("resolveStoreIntent", () => {
  it("shop mode binds b/s to buy/sell", () => {
    expect(resolveStoreIntent("shop", "char:b")).toEqual({ kind: "buy" });
    expect(resolveStoreIntent("shop", "char:s")).toEqual({ kind: "sell" });
    expect(resolveStoreIntent("shop", "char:e")).toBeUndefined();
  });

  it("pack mode binds e/u/s to equip/unequip/sell", () => {
    expect(resolveStoreIntent("pack", "char:e")).toEqual({ kind: "equip" });
    expect(resolveStoreIntent("pack", "char:u")).toEqual({ kind: "unequip" });
    expect(resolveStoreIntent("pack", "char:s")).toEqual({ kind: "sell" });
    expect(resolveStoreIntent("pack", "char:b")).toBeUndefined();
  });

  it("both modes bind escape/tab/arrows the same way", () => {
    for (const mode of ["shop", "pack"] as const) {
      expect(resolveStoreIntent(mode, "escape")).toEqual({ kind: "cancel" });
      expect(resolveStoreIntent(mode, "tab")).toEqual({ kind: "switchMode" });
      expect(resolveStoreIntent(mode, "left")).toEqual({ kind: "menuLeft" });
      expect(resolveStoreIntent(mode, "right")).toEqual({ kind: "menuRight" });
    }
  });
});

describe("reduceStoreUi", () => {
  it("Esc emits a back effect", () => {
    const result = reduceStoreUi(storeState(), { kind: "cancel" }, storeCtx());
    expect(result.effect).toEqual({ type: "back" });
  });

  it("Tab flips shop/pack and resets both cursors", () => {
    const result = reduceStoreUi(
      storeState({ mode: "shop", shopCursor: 2, packCursor: 3 }),
      { kind: "switchMode" },
      storeCtx(),
    );
    expect(result.state.mode).toBe("pack");
    expect(result.state.shopCursor).toBe(0);
    expect(result.state.packCursor).toBe(0);
  });

  it("Left/Right cycle memberIndex only when party.length > 1", () => {
    const single = reduceStoreUi(
      storeState({ memberIndex: 0 }),
      { kind: "menuRight" },
      storeCtx({ partyLength: 1 }),
    );
    // With only one member, left/right fall through to shop cursor movement.
    expect(single.state.memberIndex).toBe(0);

    const multi = reduceStoreUi(
      storeState({ memberIndex: 0 }),
      { kind: "menuRight" },
      storeCtx({ partyLength: 3 }),
    );
    expect(multi.state.memberIndex).toBe(1);

    const wrap = reduceStoreUi(
      storeState({ memberIndex: 0 }),
      { kind: "menuLeft" },
      storeCtx({ partyLength: 3 }),
    );
    expect(wrap.state.memberIndex).toBe(2);
  });

  it("shop mode wraps shopCursor and buys/sells the selected item", () => {
    const wrapUp = reduceStoreUi(
      storeState({ shopCursor: 0 }),
      { kind: "menuUp" },
      storeCtx(),
    );
    expect(wrapUp.state.shopCursor).toBeGreaterThan(0);

    const buy = reduceStoreUi(
      storeState({ shopCursor: 0 }),
      { kind: "buy" },
      storeCtx(),
    );
    expect(buy.effect).toEqual({ type: "storeBuy", itemId: "potion" });

    const sell = reduceStoreUi(
      storeState({ shopCursor: 0 }),
      { kind: "sell" },
      storeCtx(),
    );
    expect(sell.effect).toEqual({ type: "storeSell", itemId: "potion" });
  });

  it("pack mode equips/sells a backpack entry", () => {
    const member = createStartingHero();
    const backpackItem = item({ instanceId: "sword-1" });
    const entries = buildPackEntries(member, [backpackItem]);
    const ctx = storeCtx({ packEntries: entries, memberId: member.id });

    const equip = reduceStoreUi(
      storeState({ mode: "pack", packCursor: 4 }),
      { kind: "equip" },
      ctx,
    );
    expect(equip.effect).toEqual({
      type: "equip",
      instanceId: "sword-1",
      memberId: member.id,
    });

    const sell = reduceStoreUi(
      storeState({ mode: "pack", packCursor: 4 }),
      { kind: "sell" },
      ctx,
    );
    expect(sell.effect).toEqual({ type: "sellItem", instanceId: "sword-1" });
  });

  it("pack mode unequips an equipped slot even when empty", () => {
    const member = createStartingHero();
    const entries = buildPackEntries(member, []);
    const ctx = storeCtx({ packEntries: entries, memberId: member.id });

    const result = reduceStoreUi(
      storeState({ mode: "pack", packCursor: 0 }),
      { kind: "unequip" },
      ctx,
    );
    expect(result.effect).toEqual({
      type: "unequip",
      slot: "weapon",
      memberId: member.id,
    });
  });
});

// ---------------------------------------------------------------------------
// Tavern
// ---------------------------------------------------------------------------

function tavernCtx(overrides: Partial<TavernUiContext> = {}): TavernUiContext {
  return {
    recruitsLength: 2,
    partyMemberIds: ["hero-1", "member-2"],
    ...overrides,
  };
}

function tavernState(overrides: Partial<TavernUiState> = {}): TavernUiState {
  return { ...INITIAL_TAVERN_UI_STATE, ...overrides };
}

describe("resolveTavernIntent", () => {
  it("recruit mode binds the literal h key to hire (not char:h)", () => {
    expect(resolveTavernIntent("recruit", false, "h")).toEqual({
      kind: "hire",
    });
    expect(resolveTavernIntent("recruit", false, "char:h")).toBeUndefined();
  });

  it("party mode binds d to dismiss", () => {
    expect(resolveTavernIntent("party", false, "char:d")).toEqual({
      kind: "dismiss",
    });
  });

  it("party mode while confirming binds y/n/enter/escape", () => {
    expect(resolveTavernIntent("party", true, "char:y")).toEqual({
      kind: "confirmYes",
    });
    expect(resolveTavernIntent("party", true, "char:n")).toEqual({
      kind: "confirmNo",
    });
    expect(resolveTavernIntent("party", true, "enter")).toEqual({
      kind: "confirmYes",
    });
    expect(resolveTavernIntent("party", true, "escape")).toEqual({
      kind: "cancel",
    });
  });
});

describe("reduceTavernUi", () => {
  it("Tab flips recruit/party and resets cursors and confirmId", () => {
    const result = reduceTavernUi(
      tavernState({ recruitCursor: 1, partyCursor: 1, confirmId: "x" }),
      { kind: "switchMode" },
      tavernCtx(),
    );
    expect(result.state).toEqual({ ...INITIAL_TAVERN_UI_STATE, mode: "party" });
  });

  it("Esc with no confirm dialog emits a back effect", () => {
    const result = reduceTavernUi(
      tavernState(),
      { kind: "cancel" },
      tavernCtx(),
    );
    expect(result.effect).toEqual({ type: "back" });
  });

  it("Esc closes an open confirm dialog instead of leaving", () => {
    const result = reduceTavernUi(
      tavernState({ mode: "party", confirmId: "member-2" }),
      { kind: "cancel" },
      tavernCtx(),
    );
    expect(result.state.confirmId).toBeNull();
    expect(result.effect).toBeUndefined();
  });

  it("recruit mode is a no-op with an empty recruit pool", () => {
    const result = reduceTavernUi(
      tavernState(),
      { kind: "menuDown" },
      tavernCtx({ recruitsLength: 0 }),
    );
    expect(result.state).toEqual(tavernState());
  });

  it("recruit mode wraps the cursor and hires on confirm/h", () => {
    const wrapUp = reduceTavernUi(
      tavernState({ recruitCursor: 0 }),
      { kind: "menuUp" },
      tavernCtx(),
    );
    expect(wrapUp.state.recruitCursor).toBe(1);

    const hire = reduceTavernUi(
      tavernState({ recruitCursor: 1 }),
      { kind: "hire" },
      tavernCtx(),
    );
    expect(hire.effect).toEqual({ type: "hire", index: 1 });

    const hireViaConfirm = reduceTavernUi(
      tavernState({ recruitCursor: 0 }),
      { kind: "confirm" },
      tavernCtx(),
    );
    expect(hireViaConfirm.effect).toEqual({ type: "hire", index: 0 });
  });

  it("party mode: selecting the hero (index 0) never opens a confirm dialog", () => {
    const result = reduceTavernUi(
      tavernState({ mode: "party", partyCursor: 0 }),
      { kind: "confirm" },
      tavernCtx(),
    );
    expect(result.state.confirmId).toBeNull();
  });

  it("party mode: d/Enter on a non-hero member opens a confirm dialog", () => {
    const result = reduceTavernUi(
      tavernState({ mode: "party", partyCursor: 1 }),
      { kind: "dismiss" },
      tavernCtx(),
    );
    expect(result.state.confirmId).toBe("member-2");
  });

  it("confirmYes dismisses the member and clears confirmId", () => {
    const result = reduceTavernUi(
      tavernState({ mode: "party", confirmId: "member-2" }),
      { kind: "confirmYes" },
      tavernCtx(),
    );
    expect(result.effect).toEqual({ type: "dismiss", memberId: "member-2" });
    expect(result.state.confirmId).toBeNull();
  });

  it("confirmNo cancels the dialog without dismissing", () => {
    const result = reduceTavernUi(
      tavernState({ mode: "party", confirmId: "member-2" }),
      { kind: "confirmNo" },
      tavernCtx(),
    );
    expect(result.effect).toBeUndefined();
    expect(result.state.confirmId).toBeNull();
  });

  it("party mode wraps the cursor over partyMemberIds.length", () => {
    const result = reduceTavernUi(
      tavernState({ mode: "party", partyCursor: 1 }),
      { kind: "menuDown" },
      tavernCtx(),
    );
    expect(result.state.partyCursor).toBe(0);
  });
});
