---
"ts-rogue": minor
---

Inventory system (ENG-2): a dedicated Inventory screen (`v` key, from the
village, overworld, or dungeon), a village Stash, a field backpack cap, and
an opt-in loot filter.

The Inventory screen has four Tab-cycled panes: `gear` (equip/unequip, cycle
sort by rarity/ilvl/slot/value, and a full-affix inspect view), `consumables`
(use a heal item on a party member outside battle), `currency` (gold), and
`filter` (the loot filter's settings). The village Store's backpack mode now
only sells - equip/unequip/compare/inspect moved to the Inventory screen.

The field backpack for generated gear is capped at 20 instances
(`FIELD_BACKPACK_CAP`); the new village Stash (`x` from the village menu)
holds unlimited overflow, moved with `DepositItem`/`WithdrawItem` (withdraw
refuses once the field backpack is full). An opt-in loot filter auto-dismantles
a field drop for gold when it fails a rarity floor, an ilvl-vs-party-level
floor, and carries none of the player's kept affix stats - any one passing
condition keeps the item. A drop that would overflow the field backpack cap
instead raises a mandatory swap-or-dismantle prompt (dismantle the new drop,
or swap it for a carried item) before either backpack changes further.

Heal items can now be used in the field outside battle via `UseFieldItem`,
sharing the same heal table as battle item use (hoisted to
`engine/loot/consumables.ts`).

Screenshot tooling in this sandbox only captures the browser (Pixi) renderer,
and this feature is Ink (terminal) UI only, so evidence here is a terminal
text capture instead of a PNG:

```
┌─ Inventory - Gear ───────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Sort: rarity                                                                                                         │
│ > Weapon: (empty)                                                                                                    │
│   Armor: (empty)                                                                                                    │
│   Accessory 1: (empty)                                                                                              │
│   Accessory 2: (empty)                                                                                              │
│ Select an item and press Enter to inspect its affixes.                                                              │
│ ...                                                                                                                  │
│ Up/down to select, e to equip, u to unequip, r to cycle sort, Enter to inspect, Tab for consumables, Esc to go back. │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Full captures (gear/consumables/loot-filter panes, the Stash view, and the
village menu's new Stash entry) are committed under
`docs/pr-assets/ENG-2/*.txt`.
