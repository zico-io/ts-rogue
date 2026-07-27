---
"ts-rogue": minor
---

Loot pickups (battle victory and chest open) now report what was kept and
dismantled in the message log, with rarity-colored item names for kept gear
and a gold-total summary when the auto-dismantle filter discards items
(ENG-20 loot toast).

![loot toast web log](../docs/pr-assets/ENG-20/loot-toast-web.png)

Terminal (Ink) equivalent:

```
Victory! Gained 5 XP and 5 gold.
Looted Magic Clever Rusty Dagger of Evasion!      <- colored theme.rarity.magic
You open the chest and find 46 gold and 1 Potion!
Dismantled 1 item(s) -> 5g                        <- colored theme.msg.loot
```
