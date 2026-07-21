import { describe, expect, it } from "vitest";
import { attempt } from "../engine/state/incidents";
import { GameStore, newGame } from "../engine/state/store";
import { FailureBoundary } from "./incidents";

describe("failure boundaries", () => {
  it("returns typed outcomes instead of leaking exceptions", () => {
    expect(attempt(() => 42)).toEqual({ ok: true, value: 42 });
    const failed = attempt(() => {
      throw new Error("boom");
    });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect((failed.error as Error).message).toBe("boom");
  });

  it("reports caught application failures through GameStore", () => {
    const store = new GameStore(newGame(1));
    const boundary = new FailureBoundary(store);
    const categories: string[] = [];
    store.subscribeIncidents((incident) => categories.push(incident.category));

    const failed = boundary.run("save", false, () => {
      throw new Error("disk full");
    });

    expect(failed.ok).toBe(false);
    expect(categories).toEqual(["save"]);
    expect(store.getDebugJournal().at(-1)?.message).toBe("disk full");
  });
});
