import { RNG } from "rot-js";

/** Serializable rot.js RNG state, stored on GameState for deterministic replays. */
export type RngState = ReturnType<typeof RNG.getState>;

/**
 * Seeded RNG wrapper over rot.js. Each instance owns an independent generator
 * (cloned off the rot.js singleton) so engine randomness never touches global
 * state and can be serialized/restored via {@link Rng.getState}/{@link Rng.setState}.
 */
export class Rng {
  readonly seed: number;
  private readonly gen: ReturnType<typeof RNG.clone>;

  constructor(seed: number, state?: RngState) {
    this.seed = seed;
    this.gen = RNG.clone();
    this.gen.setSeed(seed);
    if (state) this.gen.setState(state);
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.gen.getUniform();
  }

  /** Uniform integer in [min, max] inclusive. */
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
