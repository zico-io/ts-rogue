/**
 * Pure loot-pickup pipeline (ENG-5, workstream 3 of the ENG-2 inventory
 * epic). Loot is already rolled (RNG-free here) by the time it reaches this
 * module, so pickup accounting is a plain, trivially unit-testable
 * function - shared by `OpenChest` (`state/store.ts`) and battle victory
 * loot (`combat/resolution.ts`'s `finalizeWon`) instead of each hand-rolling
 * its own cap check the way they used to (`[...state.items, ...loot]` with
 * no cap at all).
 *
 * ENG-18 adds the auto-dismantle filter layer: {@link applyLootPickupWithFilter}
 * partitions drops through the active {@link LootFilterRules} before the cap
 * logic runs, so dismantled items convert to gold directly without ever
 * counting against the field backpack cap.
 */

import { itemSellPrice } from "./items";
import type { LootFilterContext, LootFilterRules } from "./lootFilter";
import { shouldDismantle } from "./lootFilter";
import type { ItemInstance } from "./types";

/**
 * Overflow drops that couldn't fit in the field backpack, queued for a
 * swap-or-dismantle decision (see `GameState.pendingLootTriage`). Drops are
 * resolved one at a time, oldest first.
 */
export interface PendingLootTriage {
  drops: ItemInstance[];
}

export interface LootPickupResult {
  /** `items` with as many `drops` appended as fit under `cap`. */
  items: ItemInstance[];
  /** Leftover drops beyond `cap`, in the order they arrived - never discarded. */
  queued: ItemInstance[];
}

/**
 * Fills the remaining backpack capacity from `drops` (in order) directly
 * into `items`; anything beyond `cap` comes back as `queued` rather than
 * being dropped on the floor. The caller is responsible for routing
 * `queued` into `GameState.pendingLootTriage` via {@link queueLootTriage}.
 */
export function applyLootPickup(
  items: readonly ItemInstance[],
  drops: readonly ItemInstance[],
  cap: number,
): LootPickupResult {
  const remaining = Math.max(0, cap - items.length);
  return {
    items: [...items, ...drops.slice(0, remaining)],
    queued: drops.slice(remaining),
  };
}

/**
 * Appends newly queued overflow drops onto any already-pending triage queue
 * (never overwrites it), preserving arrival order. Returns `pending`
 * unchanged when there is nothing new to queue.
 */
export function queueLootTriage(
  pending: PendingLootTriage | null,
  queued: readonly ItemInstance[],
): PendingLootTriage | null {
  if (queued.length === 0) return pending;
  return { drops: pending ? [...pending.drops, ...queued] : [...queued] };
}

/**
 * Outcome of the auto-dismantle filter pass at pickup time.
 * Plain data shape - JSON-serializable by construction.
 */
export interface LootPickupOutcome {
  /** Items that passed the filter and were kept (may still overflow if cap exceeded). */
  kept: ItemInstance[];
  /** Items that failed all configured filter conditions and were auto-dismantled. */
  dismantled: ItemInstance[];
  /** Total gold from selling the dismantled items. */
  goldGained: number;
  // ROG-36 deferred: crafting-currency shards would extend this interface
  // with a `shardsGained` field and a `Math.floor(itemSellPrice(item) / X)`
  // conversion from dismantled items here. Do not add speculative shard
  // fields today.
}

/**
 * Filtered loot pickup: partition drops through the active loot filter,
 * convert dismantled items to gold, then run the cap-and-queue logic on
 * kept items only.
 *
 * @param items - Currently carried items (field backpack).
 * @param drops - Raw drops before any filter or cap logic.
 * @param cap - Maximum field backpack capacity.
 * @param rules - Active loot filter rules.
 * @param context - Dungeon tier and party level for filter evaluation.
 * @returns The updated items array, queued overflow, and dismantle outcome.
 */
export function applyLootPickupWithFilter(
  items: readonly ItemInstance[],
  drops: readonly ItemInstance[],
  cap: number,
  rules: LootFilterRules,
  context: LootFilterContext,
): {
  items: ItemInstance[];
  queued: ItemInstance[];
  outcome: LootPickupOutcome;
} {
  const kept: ItemInstance[] = [];
  const dismantled: ItemInstance[] = [];

  for (const drop of drops) {
    if (shouldDismantle(drop, rules, context)) {
      dismantled.push(drop);
    } else {
      kept.push(drop);
    }
  }

  const goldGained = dismantled.reduce(
    (sum, item) => sum + itemSellPrice(item),
    0,
  );

  const pickup = applyLootPickup(items, kept, cap);

  return {
    items: pickup.items,
    queued: pickup.queued,
    outcome: { kept, dismantled, goldGained },
  };
}
