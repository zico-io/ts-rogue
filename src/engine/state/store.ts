import { chestLootFor, chestLootMessage } from "../../data/dungeons";
import { findShopItem, sellPriceFor } from "../../data/shops";
import type { InventoryItem } from "../entities/party";
import { createStartingHero } from "../entities/party";
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
    worldState: createInitialWorldState(map),
    dungeonState: null,
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
 * encounter danger (with RNG jitter) and triggers a battle at the threshold.
 * Only successful moves consume RNG, keeping blocked moves fully
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
    return {
      ...state,
      scene: "battle",
      rngState: rng.getState(),
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
 * new tile. Stepping onto the boss marker flags a fixed encounter and marks
 * the boss room reached; stepping onto plain floor rolls a wandering
 * encounter against the seeded RNG; chest/stairs tiles are entered but not
 * auto-interacted with. Encounter triggers switch `scene` to `battle` as a
 * stub transition (the real battle is PROJECT_PLAN Phase 4).
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
    return {
      ...state,
      scene: "battle",
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
      return {
        ...state,
        scene: "battle",
        rngState: rng.getState(),
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
  return {
    ...state,
    gold: state.gold + loot.gold,
    inventory,
    dungeonState: { ...ds, layout },
    log: [...state.log, chestLootMessage(loot)],
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

/**
 * `BattleFlee` reducer (PROJECT_PLAN Phase 3 stub). Resolves a flagged
 * dungeon encounter by slipping back into the dungeon scene and clearing the
 * encounter marker. The real win/lose resolution arrives in Phase 4; for now
 * this keeps the playable slice flowing past wandering encounters.
 */
function battleFlee(state: GameState): GameState {
  if (state.dungeonState?.encounter) {
    return {
      ...state,
      scene: "dungeon",
      dungeonState: { ...state.dungeonState, encounter: null },
      log: [...state.log, "You slip away into the shadows"],
    };
  }
  return { ...state, log: [...state.log, "You cannot flee this fight"] };
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
    case "BattleFlee":
      return battleFlee(state);
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
