import { tierForFloor } from "../../data/lootTables";
import { itemSellPrice } from "./items";
import type { LootFilterContext, LootFilterRules } from "./lootFilter";
import { shouldDismantle } from "./lootFilter";
import type { ItemInstance } from "./types";

export function buildLootFilterContext(
  party: readonly { level: number }[],
  floor: number | null,
): LootFilterContext {
  return {
    dungeonTier: floor === null ? 1 : tierForFloor(floor),
    partyLevel: Math.max(...party.map((m) => m.level)),
  };
}

export interface PendingLootTriage {
  drops: ItemInstance[];
}

export interface LootPickupResult {
  items: ItemInstance[];

  queued: ItemInstance[];
}

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

export function queueLootTriage(
  pending: PendingLootTriage | null,
  queued: readonly ItemInstance[],
): PendingLootTriage | null {
  if (queued.length === 0) return pending;
  return { drops: pending ? [...pending.drops, ...queued] : [...queued] };
}

export interface LootPickupOutcome {
  kept: ItemInstance[];

  dismantled: ItemInstance[];

  goldGained: number;
}

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
