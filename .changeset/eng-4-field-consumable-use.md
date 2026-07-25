---
"ts-rogue": minor
---

Field consumable use (ENG-4): the Inventory screen's consumables section is
no longer a read-only browse - potions and hi-potions can now be drunk
outside battle, from the village, overworld, or dungeon. Up/Down selects a
stack, Left/Right retargets which party member it applies to (shared with
the gear section's member switcher), and `u` uses it: the target heals for
the same amount as in battle, capped at max HP, and the stack decrements
exactly like the battle item command. A downed member, an already-full-health
member, or a non-heal consumable (e.g. an antidote) is rejected with a log
message and no state change. Battle's own item command is unchanged.

The heal-item table and the consume-a-stack helper moved out of
`combat/resolution.ts` into a shared `engine/loot/consumables.ts` so both
flows stay in sync.
