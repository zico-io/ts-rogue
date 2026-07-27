import type { DrawHandle } from "./sceneView";

export interface ParticleHandle extends DrawHandle {
  setSize(size: number): void;
  setColor(color: number): void;
  setAlpha(alpha: number): void;
}

export interface ParticleDrawFactory {
  createParticle(): ParticleHandle;
}

export interface ParticleSpawn {
  x: number;
  y: number;
  color: number;
  size: number;
  lifeMs: number;

  vx?: number;
  vy?: number;

  /** Pixels/ms^2 added to vy every ms; positive falls, negative rises faster over time. */
  gravity?: number;

  /** Fades alpha to 0 over the particle's life. Defaults to true. */
  fadeOut?: boolean;
}

interface LiveParticle extends Required<Omit<ParticleSpawn, "fadeOut">> {
  handle: ParticleHandle;
  fadeOut: boolean;
  elapsed: number;
}

/**
 * A small hand-rolled particle pool behind a `DrawFactory` seam (WEB-7): ages,
 * moves, and fades particles on `tick`, capped at `maxConcurrent` so a burst
 * or an ambient field can never run away. One instance serves both use cases -
 * a one-shot keyed effect (battle hit sparks, elemental bursts, heal
 * sparkles) spawns a batch once and lets it expire; a continuous ambient
 * field (dungeon dust motes/embers) tops itself up every tick, capped the
 * same way. The Pixi adapter (`pixiParticleDrawFactory.ts`) backs
 * `ParticleHandle` with a `ParticleContainer` particle; this class never
 * touches Pixi and is fully unit-testable without WebGL.
 */
export class ParticleField {
  private particles: LiveParticle[] = [];

  constructor(
    private readonly factory: ParticleDrawFactory,
    private readonly maxConcurrent: number,
  ) {}

  get count(): number {
    return this.particles.length;
  }

  get atCapacity(): boolean {
    return this.particles.length >= this.maxConcurrent;
  }

  spawn(spawn: ParticleSpawn): void {
    if (this.atCapacity) return;
    const handle = this.factory.createParticle();
    handle.setColor(spawn.color);
    handle.setSize(spawn.size);
    handle.setPosition(spawn.x, spawn.y);
    handle.setAlpha(1);
    this.particles.push({
      handle,
      x: spawn.x,
      y: spawn.y,
      color: spawn.color,
      size: spawn.size,
      lifeMs: spawn.lifeMs,
      vx: spawn.vx ?? 0,
      vy: spawn.vy ?? 0,
      gravity: spawn.gravity ?? 0,
      fadeOut: spawn.fadeOut ?? true,
      elapsed: 0,
    });
  }

  tick(deltaMs: number): void {
    const survivors: LiveParticle[] = [];
    for (const particle of this.particles) {
      particle.elapsed += deltaMs;
      if (particle.elapsed >= particle.lifeMs) {
        particle.handle.destroy();
        continue;
      }
      particle.vy += particle.gravity * deltaMs;
      particle.x += particle.vx * deltaMs;
      particle.y += particle.vy * deltaMs;
      particle.handle.setPosition(particle.x, particle.y);
      if (particle.fadeOut) {
        particle.handle.setAlpha(
          Math.max(0, 1 - particle.elapsed / particle.lifeMs),
        );
      }
      survivors.push(particle);
    }
    this.particles = survivors;
  }

  clear(): void {
    for (const particle of this.particles) particle.handle.destroy();
    this.particles = [];
  }
}
