/**
 * Pure loot-pickup pipeline (ENG-5, workstream 3 of the ENG-2 inventory
 * epic). Loot is already rolled (RNG-free here) by the time it reaches this
 * module, so pickup accounting is a plain, trivially unit-testable
 * function - shared by `OpenChest` (`state/store.ts`) and battle victory
 * loot (`combat/resolution.ts`'s `finalizeWon`) instead of each hand-rolling
 * its own cap check the way they used to (`[...state.items, ...loot]` with
 * no cap at all).
 */

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
