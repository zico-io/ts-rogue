---
"ts-rogue": minor
---

Status cures (ENG-12): the Antidote and a new Thermal Salts item finally do
something. Antidote removes an active poison instance; Thermal Salts remove
both burn and chilled in one use. Both are consumed on use even if the target
had nothing to cure, and show up in the battle Item menu alongside heal
potions with a "cures X" label.

Heal-cleanse decision: every Heal-kind skill (Heal, Second Wind) now also
cleanses all of the caster's own status effects when cast, on top of its HP
restore - an MP-cost full reset that complements the cheaper, single-status
cure items. See the comment on `SkillKind` in `src/engine/combat/skills.ts`
for the documented rationale.

Cure items are battle-scoped like every other status effect: since statuses
clear entirely when battle ends, Antidote/Thermal Salts remain usable from the
battle Item menu only, not the field Inventory screen.
