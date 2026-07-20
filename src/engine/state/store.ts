import { chestLootFor, chestLootMessage } from "../../data/dungeons";
import { findShopItem, sellPriceFor } from "../../data/shops";
import { resolveBattleEvent, startBattle } from "../combat/resolution";
import type { InventoryItem } from "../entities/party";
import { createStartingHero } from "../entities/party";
import { type EquipmentSlotName, equipTargetSlot } from "../loot/equipment";
import { describeItem, itemSellPrice } from "../loot/items";
import { rollChestLoot } from "../loot/resolution";
import { Rng } from "../rng/rng";
import {
  createInitialDungeonState,
  DUNGEON_ENCOUNTER_CHANCE,
  DUNGEON_FLOORS,
  FOV_RADIUS,
  forwardDelta,
  isDungeonWall,
  revealArea,
  rotateFacing,
  tileFeature,
} from "../world/dungeon";
import {
  biomeDanger,
  createInitialWorldState,
  ENCOUNTER_THRESHOLD,
  generateOverworldMap,
  inBounds,
  isPassable,
  tileAt,
} from "../world/overworld";
import type { DungeonFeature, DungeonState } from "../world/types";
import type {
  GameEvent,
  GameState,
  MoveDelta,
  StepDirection,
  TurnDirection,
} from "./types";

/** Gold cost per party member to fully heal at the inn. */
export const INN_COST_PER_MEMBER = 10;

/** Build a fresh state tree for a new run from a seed, logging the seed. */
export function newGame(seed: number): GameState {
  const rng = new Rng(seed);
  const map = generateOverworldMap(seed);
  return {
    seed,
    rngState: rng.getState(),
    scene: "village",
    log: [`Started new game with seed ${seed}`],
    party: [createStartingHero()],
    gold: 50,
    inventory: [],
    items: [],
    nextItemId: 1,
    worldState: createInitialWorldState(map),
    dungeonState: null,
    battleState: null,
  };
}

/** Stack `quantity` of `itemId` onto `inventory`, merging existing stacks. */
function addItem(
  inventory: readonly InventoryItem[],
  itemId: string,
  quantity: number,
): InventoryItem[] {
  const existing = inventory.find((entry) => entry.itemId === itemId);
  return existing
    ? inventory.map((entry) =>
        entry.itemId === itemId
          ? { ...entry, quantity: entry.quantity + quantity }
          : entry,
      )
    : [...inventory, { itemId, quantity }];
}

function innHeal(state: GameState): GameState {
  const cost = state.party.length * INN_COST_PER_MEMBER;
  if (state.gold < cost) {
    return {
      ...state,
      log: [...state.log, "Not enough gold to rest at the inn"],
    };
  }
  return {
    ...state,
    gold: state.gold - cost,
    party: state.party.map((member) => ({
      ...member,
      hp: member.maxHp,
      mp: member.maxMp,
    })),
    log: [...state.log, `Healed the party for ${cost} gold`],
  };
}

function storeBuy(
  state: GameState,
  itemId: string,
  quantity: number,
): GameState {
  const item = findShopItem(itemId);
  if (!item || quantity <= 0) {
    return {
      ...state,
      log: [...state.log, `Cannot buy unknown item "${itemId}"`],
    };
  }
  const cost = item.price * quantity;
  if (state.gold < cost) {
    return {
      ...state,
      log: [...state.log, `Not enough gold to buy ${quantity} ${item.name}`],
    };
  }
  return {
    ...state,
    gold: state.gold - cost,
    inventory: addItem(state.inventory, itemId, quantity),
    log: [...state.log, `Bought ${quantity} ${item.name} for ${cost} gold`],
  };
}

function storeSell(
  state: GameState,
  itemId: string,
  quantity: number,
): GameState {
  const item = findShopItem(itemId);
  const owned = state.inventory.find((entry) => entry.itemId === itemId);
  if (!item || quantity <= 0 || !owned || owned.quantity < quantity) {
    return {
      ...state,
      log: [...state.log, `Cannot sell unknown or unowned item "${itemId}"`],
    };
  }
  const proceeds = sellPriceFor(item) * quantity;
  const remaining = owned.quantity - quantity;
  const inventory =
    remaining > 0
      ? state.inventory.map((entry) =>
          entry.itemId === itemId ? { ...entry, quantity: remaining } : entry,
        )
      : state.inventory.filter((entry) => entry.itemId !== itemId);
  return {
    ...state,
    gold: state.gold + proceeds,
    inventory,
    log: [...state.log, `Sold ${quantity} ${item.name} for ${proceeds} gold`],
  };
}

/**
 * `MoveOverworld` reducer (PROJECT_PLAN Phase 2, §4.3). The map is
 * regenerated from `state.seed` (a pure function, see `world/overworld.ts`)
 * rather than stored on state. Movement onto an impassable tile or off the
 * map edge is a no-op. Movement onto the village or a dungeon entrance
 * changes scene directly; movement onto any other passable tile accumulates
 * encounter danger (with RNG jitter) and starts a real battle at the
 * threshold. Only successful moves consume RNG, keeping blocked moves fully
 * side-effect-free. Stepping onto a dungeon entrance (PROJECT_PLAN Phase 3)
 * also seeds `dungeonState` for floor 1 of that entrance's dungeon.
 */
function moveOverworld(
  state: GameState,
  dx: MoveDelta,
  dy: MoveDelta,
): GameState {
  const map = generateOverworldMap(state.seed);
  const target = {
    x: state.worldState.player.x + dx,
    y: state.worldState.player.y + dy,
  };

  if (!inBounds(map, target) || !isPassable(tileAt(map, target))) {
    return {
      ...state,
      log: [...state.log, "The way is blocked"],
    };
  }

  const tile = tileAt(map, target);

  if (tile === "village") {
    return {
      ...state,
      scene: "village",
      worldState: { ...state.worldState, player: target },
      log: [...state.log, "You return to the village"],
    };
  }

  if (tile === "dungeonEntrance") {
    const entranceIndex = map.dungeonEntrances.findIndex(
      (point) => point.x === target.x && point.y === target.y,
    );
    const dungeonId = `dungeon-${entranceIndex}`;
    return {
      ...state,
      scene: "dungeon",
      worldState: { ...state.worldState, player: target },
      dungeonState: createInitialDungeonState(state.seed, dungeonId, 1),
      log: [...state.log, "You descend into the dungeon"],
    };
  }

  const rng = new Rng(state.seed, state.rngState);
  const jitter = 0.7 + rng.next() * 0.6;
  const meter = state.worldState.encounterMeter + biomeDanger(tile) * jitter;

  if (meter >= ENCOUNTER_THRESHOLD) {
    // Overworld battles use the floor-1 (weak) monster pool and return here.
    const battle = startBattle(
      rng,
      state.party[0],
      "wandering",
      1,
      "overworld",
    );
    return {
      ...state,
      scene: "battle",
      rngState: rng.getState(),
      battleState: battle,
      worldState: { player: target, encounterMeter: 0 },
      log: [...state.log, "A monster ambushes the party!"],
    };
  }

  return {
    ...state,
    rngState: rng.getState(),
    worldState: { player: target, encounterMeter: meter },
  };
}

/**
 * `TurnDungeon` reducer (PROJECT_PLAN Phase 3). Rotates the party 90 degrees
 * in place. Pure and side-effect-free: no RNG consumed, no log appended, no
 * exploration change.
 */
function turnDungeon(state: GameState, direction: TurnDirection): GameState {
  const ds = state.dungeonState;
  if (!ds) return state;
  return {
    ...state,
    dungeonState: { ...ds, facing: rotateFacing(ds.facing, direction) },
  };
}

/**
 * `StepDungeon` reducer (PROJECT_PLAN Phase 3). Steps one tile forward or
 * backward along the party's facing. Walls (and out-of-bounds) block the
 * step without consuming RNG. A successful step reveals the area around the
 * new tile. Stepping onto the boss marker starts a fixed boss battle and
 * marks the boss room reached; stepping onto plain floor rolls a wandering
 * encounter against the seeded RNG and starts a real battle; chest/stairs
 * tiles are entered but not auto-interacted with. Both encounter kinds call
 * `startBattle`, which consumes RNG to pick enemies and roll initiative and
 * sets `scene` to `battle` with a fresh `battleState`.
 */
function stepDungeon(state: GameState, direction: StepDirection): GameState {
  const ds = state.dungeonState;
  if (!ds) return state;
  const fwd = forwardDelta(ds.facing);
  const delta = direction === "forward" ? fwd : { x: -fwd.x, y: -fwd.y };
  const target = { x: ds.player.x + delta.x, y: ds.player.y + delta.y };

  if (isDungeonWall(ds.layout, target)) {
    return { ...state, log: [...state.log, "The way is blocked"] };
  }

  const explored = revealArea(ds.explored, ds.layout, target, FOV_RADIUS);
  const moved: DungeonState = { ...ds, player: target, explored };
  const feature = tileFeature(ds.layout, target);

  if (feature === "bossMarker") {
    const rng = new Rng(state.seed, state.rngState);
    const battle = startBattle(
      rng,
      state.party[0],
      "boss",
      ds.floor,
      "dungeon",
    );
    return {
      ...state,
      scene: "battle",
      rngState: rng.getState(),
      battleState: battle,
      dungeonState: {
        ...moved,
        reachedBoss: true,
        encounter: { kind: "boss", floor: ds.floor },
      },
      log: [...state.log, "You have reached the boss room! A guardian stirs"],
    };
  }

  if (feature === "none") {
    const rng = new Rng(state.seed, state.rngState);
    const roll = rng.next();
    if (roll < DUNGEON_ENCOUNTER_CHANCE) {
      const battle = startBattle(
        rng,
        state.party[0],
        "wandering",
        ds.floor,
        "dungeon",
      );
      return {
        ...state,
        scene: "battle",
        rngState: rng.getState(),
        battleState: battle,
        dungeonState: {
          ...moved,
          encounter: { kind: "wandering", floor: ds.floor },
        },
        log: [...state.log, "An enemy appears!"],
      };
    }
    return { ...state, rngState: rng.getState(), dungeonState: moved };
  }

  // Chest / stairs tiles: enter them, but open / descend are explicit events.
  return { ...state, dungeonState: moved };
}

/**
 * `OpenChest` reducer (PROJECT_PLAN Phase 3). Opens the chest the party
 * stands on, grants its deterministic loot, and clears the chest feature so
 * it cannot be reopened. No-ops (with a log line) when there is no chest here.
 */
function openChest(state: GameState): GameState {
  const ds = state.dungeonState;
  if (!ds) return state;
  const tile = ds.layout.tiles[ds.player.y][ds.player.x];
  if (tile.feature !== "chest") {
    return { ...state, log: [...state.log, "There is nothing to open here"] };
  }
  const loot = chestLootFor(ds.dungeonId, ds.floor, ds.player.x, ds.player.y);
  const tiles = ds.layout.tiles.map((row, y) =>
    y === ds.player.y
      ? row.map((t, x) =>
          x === ds.player.x ? { ...t, feature: "none" as DungeonFeature } : t,
        )
      : row,
  );
  const layout = { ...ds.layout, tiles };
  const inventory = loot.itemId
    ? addItem(state.inventory, loot.itemId, loot.quantity)
    : state.inventory;
  // Phase 5 (ROG-11): chests also roll a generated, affix-bearing item from the
  // floor's chest loot table, routed through the seeded RNG so saves agree.
  const rng = new Rng(state.seed, state.rngState);
  const chest = rollChestLoot(rng, ds.floor, state.nextItemId);
  const items = chest.items.length
    ? [...state.items, ...chest.items]
    : state.items;
  let message = chestLootMessage(loot);
  if (chest.items.length > 0) {
    message = `${message.replace(/!$/, "")}, plus ${describeItem(chest.items[0])}!`;
  }
  return {
    ...state,
    rngState: rng.getState(),
    gold: state.gold + loot.gold,
    inventory,
    items,
    nextItemId: chest.nextId,
    dungeonState: { ...ds, layout },
    log: [...state.log, message],
  };
}

/**
 * `DescendStairs` reducer (PROJECT_PLAN Phase 3). Descends from the stairs
 * tile the party stands on to the next floor, regenerating it deterministically
 * from `seed + dungeonId + (floor + 1)` and starting the party on the new
 * entrance. No-ops (with a log line) when not on stairs or already on the
 * lowest floor.
 */
function descendStairs(state: GameState): GameState {
  const ds = state.dungeonState;
  if (!ds) return state;
  const tile = ds.layout.tiles[ds.player.y][ds.player.x];
  if (tile.feature !== "stairsDown") {
    return { ...state, log: [...state.log, "There are no stairs down here"] };
  }
  const nextFloor = ds.floor + 1;
  if (nextFloor > DUNGEON_FLOORS) {
    return { ...state, log: [...state.log, "The stairs lead nowhere"] };
  }
  const next = createInitialDungeonState(state.seed, ds.dungeonId, nextFloor);
  return {
    ...state,
    dungeonState: next,
    log: [...state.log, `You descend to floor ${nextFloor}`],
  };
}

/* -------------------------------------------------------------------------- */
/* Phase 5 (ROG-11): equip / unequip / sell generated loot                    */
/* -------------------------------------------------------------------------- */

function equipItem(state: GameState, instanceId: string): GameState {
  const item = state.items.find((entry) => entry.instanceId === instanceId);
  if (!item) {
    return { ...state, log: [...state.log, "There is nothing to equip"] };
  }
  const hero = state.party[0];
  const target = equipTargetSlot(hero, item);
  if (!target) {
    return {
      ...state,
      log: [...state.log, `${describeItem(item)} cannot be equipped`],
    };
  }
  const swapped = hero.equipment[target];
  const items = swapped
    ? [
        ...state.items.filter((entry) => entry.instanceId !== instanceId),
        swapped,
      ]
    : state.items.filter((entry) => entry.instanceId !== instanceId);
  const party = state.party.map((member, index) =>
    index === 0
      ? { ...member, equipment: { ...member.equipment, [target]: item } }
      : member,
  );
  const logs = [`Equipped ${describeItem(item)}.`];
  if (swapped) logs.push(`${describeItem(swapped)} moved to the backpack.`);
  return { ...state, party, items, log: [...state.log, ...logs] };
}

function unequipItem(state: GameState, slot: EquipmentSlotName): GameState {
  const hero = state.party[0];
  const item = hero.equipment[slot];
  if (!item) {
    return { ...state, log: [...state.log, "Nothing is equipped there"] };
  }
  const party = state.party.map((member, index) =>
    index === 0
      ? { ...member, equipment: { ...member.equipment, [slot]: null } }
      : member,
  );
  const items = [...state.items, item];
  return {
    ...state,
    party,
    items,
    log: [...state.log, `Unequipped ${describeItem(item)}.`],
  };
}

function sellItem(state: GameState, instanceId: string): GameState {
  const item = state.items.find((entry) => entry.instanceId === instanceId);
  if (!item) {
    return { ...state, log: [...state.log, "There is nothing to sell"] };
  }
  const proceeds = itemSellPrice(item);
  const items = state.items.filter((entry) => entry.instanceId !== instanceId);
  return {
    ...state,
    gold: state.gold + proceeds,
    items,
    log: [...state.log, `Sold ${describeItem(item)} for ${proceeds} gold.`],
  };
}

/** Pure reducer: never mutates `state`. All state transitions route through here. */
export function reduce(state: GameState, event: GameEvent): GameState {
  switch (event.type) {
    case "NewGame":
      return newGame(event.seed);
    case "ChangeScene":
      return { ...state, scene: event.scene };
    case "Log":
      return { ...state, log: [...state.log, event.message] };
    case "InnHeal":
      return innHeal(state);
    case "StoreBuy":
      return storeBuy(state, event.itemId, event.quantity);
    case "StoreSell":
      return storeSell(state, event.itemId, event.quantity);
    case "EquipItem":
      return equipItem(state, event.instanceId);
    case "UnequipItem":
      return unequipItem(state, event.slot);
    case "SellItem":
      return sellItem(state, event.instanceId);
    case "MoveOverworld":
      return moveOverworld(state, event.dx, event.dy);
    case "TurnDungeon":
      return turnDungeon(state, event.direction);
    case "StepDungeon":
      return stepDungeon(state, event.direction);
    case "OpenChest":
      return openChest(state);
    case "DescendStairs":
      return descendStairs(state);
    case "BattleAttack":
    case "BattleSkill":
    case "BattleItem":
    case "BattleDefend":
    case "BattleFlee":
      return resolveBattleEvent(state, event);
  }
}

export type Listener = (state: GameState) => void;

/** Thin UI-facing holder around {@link reduce}. No Ink/React dependency. */
export class GameStore {
  private state: GameState;
  private readonly listeners = new Set<Listener>();

  constructor(initial: GameState) {
    this.state = initial;
  }

  getState(): GameState {
    return this.state;
  }

  dispatch(event: GameEvent): GameState {
    this.state = reduce(this.state, event);
    for (const listener of this.listeners) listener(this.state);
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
