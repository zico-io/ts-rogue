---
"ts-rogue": minor
---

Loot filter settings pane (ENG-19): a cursor-driven editor inside the
Inventory screen (Tab cycles gear -> consumables -> currency -> quest ->
filter) lets the player configure auto-dismantle rules live. Three settings
are editable:

- Minimum rarity per dungeon tier (rows 0-2: tier 1, tier 2, tier 3+),
  cycling through none/common/magic/rare/unique
- Minimum ilvl offset vs party level (row 3), cycling through
  none/-5/-3/0/3/5/10
- Affix-type keep-list toggles (rows 4-7: str, agi, vit, int), toggling
  each stat on/off

Each change dispatches SetLootFilter immediately and the new rules survive
save/load. Up/down moves the row cursor; Enter/Left/Right cycles the
selected row's value. The pane is a fifth section in the existing Inventory
screen alongside gear, consumables, currency, and quest items.

Terminal evidence (Ink-only screen, no web/Pixi equivalent) after editing
Tier 1 to `magic`, the ilvl offset to `-5`, and toggling `str` on:

```
┌─ Inventory - Loot Filter ──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Minimum Rarity by Tier                                                                                                         │
│   Tier 1: magic                                                                                                                │
│   Tier 2: none                                                                                                                 │
│   Tier 3+: none                                                                                                                │
│ Item Level Offset                                                                                                              │
│ > Min ilvl vs party: -5                                                                                                        │
│ Keep Affix Types                                                                                                               │
│   str: yes                                                                                                                     │
│   agi: no                                                                                                                      │
│   vit: no                                                                                                                      │
│   int: no                                                                                                                      │
│                                                                                                                                │
│ Row 4/8 - Enter/Left/Right changes value                                                                                       │
```
