# Product

- The milestone proves a replayable village, overworld, dungeon, battle, loot, and village loop. <source: PROJECT_PLAN.md section 2, 2026-07-19>
- TypeScript on Node.js 24+, Ink, rot.js, seeded randomness, and a central serializable reducer store are the runtime architecture. <source: package.json and src/engine/state, 2026-07-20>
- Engine modules must not import UI modules. <source: PROJECT_PLAN.md section 1, 2026-07-19>
- The first-person dungeon view renders perspective-projected wall faces and interactables as Braille wireframes. <source: src/ui/screens/dungeon/render.ts, 2026-07-20>
- Work advances through phases 0 to 6, and each phase ends with a playable vertical slice. <source: PROJECT_PLAN.md section 3, 2026-07-19>
- The first playable loop uses one hero; party expansion is deferred until the loop is proven. <source: PROJECT_PLAN.md section 10, 2026-07-19>
