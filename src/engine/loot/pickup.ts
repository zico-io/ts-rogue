import { tierForFloor } from "../../data/lootTables";
import { entry, type LogEntry } from "../log";
import { describeItem, itemSellPrice } from "./items";
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

/**
 * Build the log lines for a pickup outcome (ENG-20 loot toast): one
 * rarity-colored "Looted ...!" line per kept item, followed by a single
 * "Dismantled N item(s) -> Gg" summary line when the filter discarded
 * anything. Shared by both pickup sites (`openChest` and battle victory's
 * `finalizeWon`) so the line-building and text templates live in one place.
 */
export function lootLogEntries(outcome: LootPickupOutcome): LogEntry[] {
  const keptLines = outcome.kept.map((item) =>
    entry(`Looted ${describeItem(item)}!`, "loot", { rarity: item.rarity }),
  );
  const dismantleLines = outcome.dismantled.length
    ? [
        entry(
          `Dismantled ${outcome.dismantled.length} item(s) -> ${outcome.goldGained}g`,
          "loot",
        ),
      ]
    : [];
  return [...keptLines, ...dismantleLines];
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
