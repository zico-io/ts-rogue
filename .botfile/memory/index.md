# Memory index

Read only the topic files needed for the active task.

The golden product SSOT used to be a single product.md file; every
shipped-behavior change appended near its tail, so concurrent branches
collided there constantly. It is now split one-topic-per-file under
`domain/` per the discipline below, so unrelated changes land in different
files.

- `domain/architecture.md` - runtime stack, engine/UI boundary, and core game model. <source: repository code and READMEs, 2026-07-23>
- `domain/world.md` - overworld, village, and dungeon-entrance navigation and placement. <source: repository code and READMEs, 2026-07-25>
- `domain/combat.md` - battle status effects, elemental damage, formation, and skill targeting. <source: repository code and READMEs, 2026-07-26>
- `domain/loot.md` - item generation, inventory management, and loot presentation. <source: repository code and READMEs, 2026-07-23>
- `domain/presentation.md` - rendering and screen-level facts shared by the terminal and web renderers. <source: repository code and READMEs, 2026-07-23>
- `tools/development.md` - local development and verification commands. <source: package.json, 2026-07-19>
- `tools/linear.md` - division of responsibility between Linear and GitHub. <source: repository scaffolding request, 2026-07-19>
- `tools/orchestration.md` - herdr and orbal-net multi-agent protocol. <source: AGENTS.md orchestration protocol, 2026-07-19>
