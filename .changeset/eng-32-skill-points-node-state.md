---
"ts-rogue": minor
---

Skill points & node state on PartyMember (ENG-32). Every party member now
tracks `skillPoints` and `unlockedNodes`, and leveling up grants exactly one
skill point per level gained on top of the existing stat/HP/MP growth.

A new pure `unlockSkillNode` spends a point on a node from the member's
class tree (`ClassDef.treeId` -> `SKILL_TREES`), validating that the node
exists, isn't already unlocked, has every prerequisite already unlocked, and
that the member can afford its cost. A rejected spend returns the member
unchanged plus a reason (`unknown-node`, `already-unlocked`,
`missing-prerequisite`, `insufficient-points`).

Old saves load with zero skill points and an empty unlock list - levels
reached before this shipped are not backfilled retroactively.

No UI to view or spend points yet; the starter tree content and the spend
screen ship in follow-up work (ENG-33/ENG-35), so every real lookup
currently resolves as `unknown-node` until those land.
