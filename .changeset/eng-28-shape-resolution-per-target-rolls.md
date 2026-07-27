---
"ts-rogue": minor
---

Shape resolution & per-target rolls (ENG-28). A `SkillDef`'s target shape now
expands into a concrete target list through one shared resolver used by both
a party member's Skill command and a monster's turn:

- `row` splashes every living enemy sharing the anchor's formation row.
- `column` pierces the anchor's lane in both rows, ignoring the basic
  attack's front/back melee-reachability rule.
- `allEnemies` / `allAllies` hit everyone living on that side.
- `randomN` hits `hitCount` distinct living targets chosen without
  replacement.

Every resolved target rolls its own crit, damage, and status-application
independently - never one roll broadcast across the whole group. A monster
carrying an attack-kind skill in its list now always casts one instead of a
basic attack, through the same resolver.

Four new skills exercise the added shapes: Hailstorm (Wizard, row, ice),
Skewer (Warrior, column), Meteor (Wizard, allEnemies; also a Dungeon Guardian
ability), and Scattershot (Rogue, randomN x3).
