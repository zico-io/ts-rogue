---
"ts-rogue": minor
---

Village Stash and a field-backpack cap (ENG-5, workstream 3 of the ENG-2
inventory epic). The village gets a new Stash building (`x`) with unlimited
storage for generated gear, separate from the field backpack: deposit an
item from the backpack (`d`) or withdraw one from the stash (`w`), both
panes reusing the Inventory screen's sort/filter list. Consumables,
currency, and quest items are unaffected - only rolled gear counts against
either limit.

The field backpack (`GameState.items`) is now capped at 20 slots
(`FIELD_BACKPACK_CAP`). Chest loot and battle victory loot both route
through a shared cap-aware pickup pipeline: when a drop would overflow the
cap, it queues for a mandatory swap-or-dismantle decision instead of being
lost or silently exceeding the cap. A new "Backpack Full" overlay shows the
queued drop and lets you either dismantle a carried item to make room (then
carry the new drop) or dismantle the drop itself - either way for gold,
never a silent loss.

```
┌─ Backpack Full ──────────────────────────────────────────────┐
│ Your backpack is full. 2 drops await a decision.              │
│                                                                │
│ Rare Leather Vest - +3 VIT                                    │
│                                                                │
│ [s] Swap: dismantle a carried item for gold, then carry this  │
│     instead.                                                  │
│ [d] Dismantle: sell this drop for gold and keep your current  │
│     backpack.                                                 │
└────────────────────────────────────────────────────────────────┘
```
