import { RNG } from "rot-js";

export type RngState = ReturnType<typeof RNG.getState>;

/** Serializable seeded RNG isolated from rot.js's global generator. */
export class Rng {
  readonly seed: number;
  private readonly gen: ReturnType<typeof RNG.clone>;

  constructor(seed: number, state?: RngState) {
    this.seed = seed;
    this.gen = RNG.clone();
    this.gen.setSeed(seed);
    if (state) this.gen.setState(state);
  }

  next(): number {
    return this.gen.getUniform();
  }

  int(min: number, max: number): number {
    return this.gen.getUniformInt(min, max);
  }

  pick<T>(items: readonly T[]): T {
    const choice = this.gen.getItem(items as T[]);
    if (choice === null) throw new Error("Rng.pick called with an empty array");
    return choice;
  }

  getState(): RngState {
    return this.gen.getState();
  }

  setState(state: RngState): void {
    this.gen.setState(state);
  }
}
