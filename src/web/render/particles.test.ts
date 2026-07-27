import { describe, expect, it, vi } from "vitest";
import type { ParticleDrawFactory, ParticleHandle } from "./particles";
import { ParticleField } from "./particles";

interface FakeParticle extends ParticleHandle {
  setPosition: ReturnType<typeof vi.fn<(x: number, y: number) => void>>;
  setSize: ReturnType<typeof vi.fn<(size: number) => void>>;
  setColor: ReturnType<typeof vi.fn<(color: number) => void>>;
  setAlpha: ReturnType<typeof vi.fn<(alpha: number) => void>>;
  destroy: ReturnType<typeof vi.fn<() => void>>;
}

function fakeFactory(): ParticleDrawFactory & { particles: FakeParticle[] } {
  const particles: FakeParticle[] = [];
  return {
    particles,
    createParticle(): ParticleHandle {
      const handle: FakeParticle = {
        setPosition: vi.fn(),
        setSize: vi.fn(),
        setColor: vi.fn(),
        setAlpha: vi.fn(),
        destroy: vi.fn(),
      };
      particles.push(handle);
      return handle;
    },
  };
}

describe("ParticleField", () => {
  it("spawns a particle with its initial position, size, and color", () => {
    const factory = fakeFactory();
    const field = new ParticleField(factory, 10);

    field.spawn({ x: 5, y: 8, color: 0xff0000, size: 4, lifeMs: 500 });

    expect(field.count).toBe(1);
    expect(factory.particles[0].setPosition).toHaveBeenCalledWith(5, 8);
    expect(factory.particles[0].setColor).toHaveBeenCalledWith(0xff0000);
    expect(factory.particles[0].setSize).toHaveBeenCalledWith(4);
  });

  it("caps concurrent particles - a spawn past the cap is dropped", () => {
    const factory = fakeFactory();
    const field = new ParticleField(factory, 2);

    field.spawn({ x: 0, y: 0, color: 0, size: 1, lifeMs: 500 });
    field.spawn({ x: 0, y: 0, color: 0, size: 1, lifeMs: 500 });
    field.spawn({ x: 0, y: 0, color: 0, size: 1, lifeMs: 500 });

    expect(field.count).toBe(2);
    expect(factory.particles.length).toBe(2);
  });

  it("moves a particle by velocity and fades its alpha toward zero as it ages", () => {
    const factory = fakeFactory();
    const field = new ParticleField(factory, 10);
    field.spawn({
      x: 0,
      y: 0,
      vx: 0.1,
      vy: -0.2,
      color: 0,
      size: 1,
      lifeMs: 1000,
    });

    field.tick(500);

    const particle = factory.particles[0];
    expect(particle.setPosition).toHaveBeenLastCalledWith(50, -100);
    expect(particle.setAlpha).toHaveBeenLastCalledWith(0.5);
    expect(particle.destroy).not.toHaveBeenCalled();
  });

  it("destroys and drops a particle once it exceeds its lifetime", () => {
    const factory = fakeFactory();
    const field = new ParticleField(factory, 10);
    field.spawn({ x: 0, y: 0, color: 0, size: 1, lifeMs: 300 });

    field.tick(300);

    expect(factory.particles[0].destroy).toHaveBeenCalled();
    expect(field.count).toBe(0);
  });

  it("applies gravity as acceleration on vy over time", () => {
    const factory = fakeFactory();
    const field = new ParticleField(factory, 10);
    field.spawn({
      x: 0,
      y: 0,
      vy: 0,
      gravity: 0.01,
      color: 0,
      size: 1,
      lifeMs: 1000,
    });

    field.tick(100);

    // vy after 100ms = 0 + 0.01 * 100 = 1; y += 1 * 100 = 100
    expect(factory.particles[0].setPosition).toHaveBeenLastCalledWith(0, 100);
  });

  it("clear destroys every live particle immediately", () => {
    const factory = fakeFactory();
    const field = new ParticleField(factory, 10);
    field.spawn({ x: 0, y: 0, color: 0, size: 1, lifeMs: 500 });
    field.spawn({ x: 0, y: 0, color: 0, size: 1, lifeMs: 500 });

    field.clear();

    expect(field.count).toBe(0);
    for (const particle of factory.particles) {
      expect(particle.destroy).toHaveBeenCalled();
    }
  });
});
