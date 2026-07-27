import { Particle, ParticleContainer, Texture } from "pixi.js";
import type { ParticleDrawFactory, ParticleHandle } from "./particles";

/**
 * Backs `ParticleHandle` with a real Pixi v8 `ParticleContainer` particle -
 * the "small hand-rolled emitter over Pixi's built-in ParticleContainer"
 * from WEB-7. Every particle shares `Texture.WHITE` (a 1x1 opaque texture,
 * as `ParticleContainer` requires one shared base texture) and is drawn as a
 * tinted, scaled square; `setSize` scales that square to the requested pixel
 * size.
 */
export function createPixiParticleDrawFactory(
  particleContainer: ParticleContainer,
): ParticleDrawFactory {
  return {
    createParticle(): ParticleHandle {
      const particle = new Particle({ texture: Texture.WHITE });
      particleContainer.addParticle(particle);
      return {
        setPosition(x: number, y: number) {
          particle.x = x;
          particle.y = y;
        },
        setSize(size: number) {
          particle.scaleX = size;
          particle.scaleY = size;
        },
        setColor(color: number) {
          particle.tint = color;
        },
        setAlpha(alpha: number) {
          particle.alpha = alpha;
        },
        destroy() {
          particleContainer.removeParticle(particle);
        },
      };
    },
  };
}

/**
 * Particles only ever move and fade (position/color dynamic); everything
 * else (vertex layout, uvs) stays static for speed, per `ParticleContainer`'s
 * own guidance to keep as few properties dynamic as possible.
 */
export function createEffectParticleContainer(): ParticleContainer {
  return new ParticleContainer({
    dynamicProperties: { position: true, color: true },
  });
}
