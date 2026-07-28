---
"ts-rogue": minor
---

Battle skill menu + passive stat aggregation from unlocked nodes (ENG-34).

The battle skill menu no longer shows only `ClassDef.skills`: `memberSkills`
(`combat/skills.ts`) adds the `skillId` of every unlocked active-skill node
from the member's class tree, so spending a point on an active node makes it
castable immediately.

`effectiveStats` (`loot/equipment.ts`) now also sums every unlocked passive
node's stat bonus on top of base stats and equipment, so `atkFrom`/`defFrom`/
`spdFrom` reflect spent skill points automatically.

A member with no unlocked nodes behaves exactly as before. `SKILL_TREES` is
still empty (starter content ships in ENG-35), so this has no visible effect
until then.
