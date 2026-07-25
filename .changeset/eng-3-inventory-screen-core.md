---
"ts-rogue": minor
---

Inventory screen core (ENG-3): a dedicated Inventory screen (`v`, usable
anywhere outside battle - village, overworld, or dungeon) is now the
canonical place to browse and manage gear. It has four sections cycled with
Tab: gear, consumables, currency, and quest items (quest items have no
backing data model yet and render an explicit empty state).

The gear section lists the selected party member's four equipment slots plus
their backpack, sorts the backpack by rarity, item level, slot, or value
(`r` cycles the sort), lets you inspect an item's full per-affix lines
(Enter), compares an unequipped item against what's equipped, and
equips/unequips (`e`/`u`) for any party member (Left/Right switches member
when the party has more than one). Consumables and currency are read-only
browses of owned stacks and gold; using a consumable is a future workstream.

The village Store's backpack mode is now sell-only (`s`) - browsing,
inspecting, comparing, and equipping/unequipping gear moved to the
Inventory screen.
