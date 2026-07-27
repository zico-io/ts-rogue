---
"ts-rogue": minor
---

Renderer-local visual effects for the PixiJS renderer (WEB-7, ROG-67 art
direction §6): battle hits and spells now spawn a colored particle burst -
a narrow melee spark arc for physical hits, a radial burst for
fire/ice/lightning/poison, colored from the existing `theme.element` palette
tokens - plus heal sparkles on an HP rise and a brief position-shake on the
struck sprite; the dungeon scene drifts ambient dust motes/embers through the
torchlight. Both share a new pooled, capacity-capped particle emitter
(`src/web/render/particles.ts`) over a real Pixi `ParticleContainer` - no new
dependency. Every effect is derived from state deltas already observed
across renders (the same technique the existing floating damage numbers use)
and is additive and gated on `prefers-reduced-motion`: with motion reduced,
bursts/sparkles/ambient fields/shake all stop while damage numerals and
name/HP text stay fully legible. The terminal renderer and `GameState`/
`GameEvent` are unaffected. Keyed effects are procedural placeholders behind
the same `DrawFactory` seam pending the Minifantasy effect sheets (not yet
vendored).
