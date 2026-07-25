/**
 * Loot pickup pipeline (ENG-2): every new gear drop (a dungeon chest, a
 * battle victory) runs through the loot filter, then the field backpack cap,
 * before landing in `state.items`. Filter-dismantled items sell themselves
 * automatically; a drop that would overflow the cap instead produces a
 * `PendingLootTriage` the UI must resolve (swap it for a carried item, or
 * dismantle the new drop) before either backpack changes further - see
 * `state/store.ts`'s `resolveLootTriage`.
 */

import { FIELD_BACKPACK_CAP } from "./inventory";
import { itemSellPrice } from "./items";
import { type LootFilterSettings, shouldDismantle } from "./lootFilter";
import type { ItemInstance } from "./types";

export interface PendingLootTriage {
  /** The drop that overflowed the backpack and needs a player decision. */
  drop: ItemInstance;
  /** Further drops still waiting behind `drop`, unfiltered and uncapped. */
  queue: ItemInstance[];
}

export interface LootPickupResult {
  /** `state.items` after keeping what fits. */
  items: ItemInstance[];
  /** Gold gained from auto-dismantled drops; add to `state.gold`. */
  gold: number;
  /** Set when a drop overflowed the cap and needs a swap-or-dismantle decision. */
  pendingLootTriage: PendingLootTriage | null;
  /** Drops that were kept (for the toast log line). */
  kept: ItemInstance[];
  /** Drops the filter auto-dismantled (for the toast log line; triage dismantles are separate). */
  dismantled: ItemInstance[];
}

/**
 * Process `newDrops` in order against `currentItems`: filter-dismantle first,
 * then keep whatever still fits under `FIELD_BACKPACK_CAP`. The moment a kept
 * drop would overflow the cap, processing stops - that drop becomes the
 * pending triage and every drop still behind it is handed back raw in
 * `queue`, to be filtered/capped again once the triage resolves (see
 * `resolveLootTriage`, which calls this again with the queue).
 */
export function applyLootPickup(
  currentItems: readonly ItemInstance[],
  newDrops: readonly ItemInstance[],
  filter: LootFilterSettings,
  partyLevel: number,
): LootPickupResult {
  const items = [...currentItems];
  const kept: ItemInstance[] = [];
  const dismantled: ItemInstance[] = [];
  let gold = 0;
  let pendingLootTriage: PendingLootTriage | null = null;

  for (let i = 0; i < newDrops.length; i++) {
    const drop = newDrops[i];
    if (shouldDismantle(drop, filter, partyLevel)) {
      gold += itemSellPrice(drop);
      dismantled.push(drop);
      continue;
    }
    if (items.length < FIELD_BACKPACK_CAP) {
      items.push(drop);
      kept.push(drop);
      continue;
    }
    pendingLootTriage = { drop, queue: newDrops.slice(i + 1) };
    break;
  }

  return { items, gold, pendingLootTriage, kept, dismantled };
}
