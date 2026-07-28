# Architecture

Core, low-churn facts about the runtime stack, the engine/UI split, and the
cross-cutting game model. Part of the golden product SSOT (see
`.botfile/memory/index.md`); `pnpm docs:lint` reports drift.

- ts-rogue is a replayable terminal dungeon crawler whose loop runs village, overworld, dungeon, battle, loot, and back to village. <source: PROJECT_PLAN.md and src/engine/world, 2026-07-23>
- The runtime is TypeScript on Node.js 24+ with Ink for the terminal UI, rot.js for procedural generation, seeded randomness, and a central serializable reducer store. <source: package.json and src/engine/state/store.ts, 2026-07-23>
- Engine modules must never import UI modules; the boundary is enforced by a biome rule. <source: biome.json and src/engine/README.md, 2026-07-23>
- Play is party-based: a multi-member party fights in battle, not a single hero. <source: src/engine/state/types.ts and src/engine/combat/resolution.ts, 2026-07-23>
- Characters have classes (warrior, rogue, wizard) that carry distinct skills and stats. <source: src/data/classes.ts and src/engine/combat/skills.ts, 2026-07-23>
- Game state persists to a serializable save so runs resume across sessions. <source: src/persistence/save.ts, 2026-07-23>
