import { describe, expect, it } from "vitest";
import { Rng } from "./rng.js";

describe("Rng", () => {
  it("produces an identical sequence for a given seed", () => {
    const a = new Rng(1234);
    const b = new Rng(1234);
    const seqA = Array.from({ length: 5 }, () => a.next());
    const seqB = Array.from({ length: 5 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("resumes the exact sequence from a saved state", () => {
    const rng = new Rng(42);
    rng.next();
    rng.next();
    const resumed = new Rng(42, rng.getState());
    const next3 = Array.from({ length: 3 }, () => rng.next());
    const resumed3 = Array.from({ length: 3 }, () => resumed.next());
    expect(resumed3).toEqual(next3);
  });

  it("stays within range and picks from a list", () => {
    const rng = new Rng(7);
    for (let i = 0; i < 50; i++) {
      const n = rng.int(1, 6);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(6);
    }
    expect(["a", "b", "c"]).toContain(rng.pick(["a", "b", "c"]));
  });
});
