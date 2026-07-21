import { findClass } from "../../data/classes";
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
import {
  attempt,
  createGameIncident,
  DEBUG_JOURNAL_LIMIT,
  type DebugJournalEntry,
  eventName,
  type GameIncident,
  type IncidentCategory,
  StateInvariantError,
  summarizeState,
  validateGameState,
} from "./incidents";
import {
  entry,
  type GameEvent,
  type GameState,
  type LogEntry,
  type MoveDelta,
  type StepDirection,
  type TurnDirection,
} from "./types";

/** Gold cost per party member to fully heal at the inn. */
export const INN_COST_PER_MEMBER = 10;

/** Options for starting a new run (Phase 6, ROG-12; ROG-17 class choice). */
export interface NewGameOptions {
  /** When true, a defeat ends the run instead of reviving at the village. */
  permadeath?: boolean;
  /** Character class id for the starting hero; defaults to warrior when omitted. */
  classId?: string;
}

/** Build a fresh state tree for a new run from a seed, logging the seed. */
export function newGame(seed: number, options?: NewGameOptions): GameState {
  const rng = new Rng(seed);
  const map = generateOverworldMap(seed);
  return {
    seed,
    rngState: rng.getState(),
    scene: "village",
    log: [entry(`Started new game with seed ${seed}`, "quest")],
    party: [createStartingHero(options?.classId)],
    gold: 50,
    inventory: [],
    items: [],
    nextItemId: 1,
    worldState: createInitialWorldState(map),
    dungeonState: null,
    battleState: null,
    flags: { permadeath: options?.permadeath ?? false, gameOver: false },
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
      log: [...state.log, entry("Not enough gold to rest at the inn")],
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
    log: [...state.log, entry(`Healed the party for ${cost} gold`)],
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
      log: [...state.log, entry(`Cannot buy unknown item "${itemId}"`)],
    };
  }
  const cost = item.price * quantity;
  if (state.gold < cost) {
    return {
      ...state,
      log: [
        ...state.log,
        entry(`Not enough gold to buy ${quantity} ${item.name}`),
      ],
    };
  }
  return {
    ...state,
    gold: state.gold - cost,
    inventory: addItem(state.inventory, itemId, quantity),
    log: [
      ...state.log,
      entry(`Bought ${quantity} ${item.name} for ${cost} gold`, "loot"),
    ],
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
      log: [
        ...state.log,
        entry(`Cannot sell unknown or unowned item "${itemId}"`),
      ],
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
    log: [
      ...state.log,
      entry(`Sold ${quantity} ${item.name} for ${proceeds} gold`, "loot"),
    ],
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
      log: [...state.log, entry("The way is blocked")],
    };
  }

  const tile = tileAt(map, target);

  if (tile === "village") {
    return {
      ...state,
      scene: "village",
      worldState: { ...state.worldState, player: target },
      log: [...state.log, entry("You return to the village", "quest")],
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
      log: [...state.log, entry("You descend into the dungeon", "quest")],
    };
  }

  const rng = new Rng(state.seed, state.rngState);
  const jitter = 0.7 + rng.next() * 0.6;
  const meter = state.worldState.encounterMeter + biomeDanger(tile) * jitter;

  if (meter >= ENCOUNTER_THRESHOLD) {
    // Overworld battles use the floor-1 (weak) monster pool and return here.
    const battle = startBattle(rng, state.party, "wandering", 1, "overworld");
    return {
      ...state,
      scene: "battle",
      rngState: rng.getState(),
      battleState: battle,
      worldState: { player: target, encounterMeter: 0 },
      log: [...state.log, entry("A monster ambushes the party!", "damage")],
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
    return { ...state, log: [...state.log, entry("The way is blocked")] };
  }

  const explored = revealArea(ds.explored, ds.layout, target, FOV_RADIUS);
  const moved: DungeonState = { ...ds, player: target, explored };
  const feature = tileFeature(ds.layout, target);

  if (feature === "bossMarker") {
    const rng = new Rng(state.seed, state.rngState);
    const battle = startBattle(rng, state.party, "boss", ds.floor, "dungeon");
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
      log: [
        ...state.log,
        entry("You have reached the boss room! A guardian stirs", "quest"),
      ],
    };
  }

  if (feature === "none") {
    const rng = new Rng(state.seed, state.rngState);
    const roll = rng.next();
    if (roll < DUNGEON_ENCOUNTER_CHANCE) {
      const battle = startBattle(
        rng,
        state.party,
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
        log: [...state.log, entry("An enemy appears!", "damage")],
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
    return {
      ...state,
      log: [...state.log, entry("There is nothing to open here")],
    };
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
    log: [...state.log, entry(message, "loot")],
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
    return {
      ...state,
      log: [...state.log, entry("There are no stairs down here")],
    };
  }
  const nextFloor = ds.floor + 1;
  if (nextFloor > DUNGEON_FLOORS) {
    return { ...state, log: [...state.log, entry("The stairs lead nowhere")] };
  }
  const next = createInitialDungeonState(state.seed, ds.dungeonId, nextFloor);
  return {
    ...state,
    dungeonState: next,
    log: [...state.log, entry(`You descend to floor ${nextFloor}`, "quest")],
  };
}

/**
 * `ExitDungeon` reducer (Phase 6, ROG-12). Leaves the active dungeon and
 * returns the party to the overworld at the dungeon entrance tile (which is
 * where `worldState.player` was left when the party entered). Clears
 * `dungeonState` and any lingering `battleState`, and resets the overworld
 * encounter meter so re-entering the overworld does not ambush the party
 * immediately. This is the dedicated exit path that prevents the dungeon
 * from being a dead-end after clearing a floor or defeating the boss.
 */
function exitDungeon(state: GameState): GameState {
  const ds = state.dungeonState;
  if (!ds) return state;
  return {
    ...state,
    scene: "overworld",
    worldState: { ...state.worldState, encounterMeter: 0 },
    dungeonState: null,
    battleState: null,
    log: [...state.log, entry("You emerge from the dungeon", "quest")],
  };
}

/* -------------------------------------------------------------------------- */
/* Phase 5 (ROG-11): equip / unequip / sell generated loot                    */
/* -------------------------------------------------------------------------- */

function equipItem(
  state: GameState,
  instanceId: string,
  memberId: string,
): GameState {
  const item = state.items.find((entry) => entry.instanceId === instanceId);
  if (!item) {
    return {
      ...state,
      log: [...state.log, entry("There is nothing to equip")],
    };
  }
  const memberIndex = state.party.findIndex((m) => m.id === memberId);
  if (memberIndex === -1) {
    return {
      ...state,
      log: [...state.log, entry("There is nothing to equip")],
    };
  }
  const member = state.party[memberIndex];
  const target = equipTargetSlot(member, item);
  if (!target) {
    return {
      ...state,
      log: [...state.log, entry(`${describeItem(item)} cannot be equipped`)],
    };
  }
  const swapped = member.equipment[target];
  const items = swapped
    ? [
        ...state.items.filter((entry) => entry.instanceId !== instanceId),
        swapped,
      ]
    : state.items.filter((entry) => entry.instanceId !== instanceId);
  const party = state.party.map((entry, index) =>
    index === memberIndex
      ? { ...entry, equipment: { ...entry.equipment, [target]: item } }
      : entry,
  );
  const logs: LogEntry[] = [entry(`Equipped ${describeItem(item)}.`, "loot")];
  if (swapped)
    logs.push(entry(`${describeItem(swapped)} moved to the backpack.`, "loot"));
  return { ...state, party, items, log: [...state.log, ...logs] };
}

function unequipItem(
  state: GameState,
  slot: EquipmentSlotName,
  memberId: string,
): GameState {
  const memberIndex = state.party.findIndex((m) => m.id === memberId);
  if (memberIndex === -1) {
    return {
      ...state,
      log: [...state.log, entry("Nothing is equipped there")],
    };
  }
  const member = state.party[memberIndex];
  const item = member.equipment[slot];
  if (!item) {
    return {
      ...state,
      log: [...state.log, entry("Nothing is equipped there")],
    };
  }
  const party = state.party.map((entry, index) =>
    index === memberIndex
      ? { ...entry, equipment: { ...entry.equipment, [slot]: null } }
      : entry,
  );
  const items = [...state.items, item];
  return {
    ...state,
    party,
    items,
    log: [...state.log, entry(`Unequipped ${describeItem(item)}.`, "loot")],
  };
}

/**
 * `RecruitMember` reducer (ROG-20 dev/manual testing helper; ROG-21 will add
 * a tavern recruiting UI on top of this). Appends a fresh member built from
 * `createStartingHero`, capped at 4 party members.
 */
function recruitMember(state: GameState, classId: string): GameState {
  if (state.party.length >= 4) {
    return {
      ...state,
      log: [...state.log, entry("The party is already full")],
    };
  }
  const cls = findClass(classId);
  const id = `member-${state.party.length + 1}`;
  const name = cls?.name ?? classId;
  const member = createStartingHero(classId, id, name);
  return {
    ...state,
    party: [...state.party, member],
    log: [...state.log, entry(`Recruited ${name} the ${classId}!`, "quest")],
  };
}

function sellItem(state: GameState, instanceId: string): GameState {
  const item = state.items.find((entry) => entry.instanceId === instanceId);
  if (!item) {
    return { ...state, log: [...state.log, entry("There is nothing to sell")] };
  }
  const proceeds = itemSellPrice(item);
  const items = state.items.filter((entry) => entry.instanceId !== instanceId);
  return {
    ...state,
    gold: state.gold + proceeds,
    items,
    log: [
      ...state.log,
      entry(`Sold ${describeItem(item)} for ${proceeds} gold.`, "loot"),
    ],
  };
}

/** Pure reducer: never mutates `state`. All state transitions route through here. */
export function reduce(state: GameState, event: GameEvent): GameState {
  switch (event.type) {
    case "NewGame":
      return newGame(event.seed, {
        permadeath: event.permadeath,
        classId: event.classId,
      });
    case "ChangeScene":
      return { ...state, scene: event.scene };
    case "Log":
      return {
        ...state,
        log: [...state.log, entry(event.message, event.kind)],
      };
    case "InnHeal":
      return innHeal(state);
    case "StoreBuy":
      return storeBuy(state, event.itemId, event.quantity);
    case "StoreSell":
      return storeSell(state, event.itemId, event.quantity);
    case "EquipItem":
      return equipItem(state, event.instanceId, event.memberId);
    case "UnequipItem":
      return unequipItem(state, event.slot, event.memberId);
    case "SellItem":
      return sellItem(state, event.instanceId);
    case "RecruitMember":
      return recruitMember(state, event.classId);
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
    case "ExitDungeon":
      return exitDungeon(state);
    case "BattleAttack":
    case "BattleSkill":
    case "BattleItem":
    case "BattleDefend":
    case "BattleFlee":
      return resolveBattleEvent(state, event);
  }
}

export type Listener = (state: GameState) => void;
export type IncidentListener = (incident: GameIncident) => void;

/** Thin UI-facing holder around {@link reduce}. No Ink/React dependency. */
export class GameStore {
  private state: GameState;
  private readonly listeners = new Set<Listener>();
  private readonly incidentListeners = new Set<IncidentListener>();
  private readonly journal: DebugJournalEntry[] = [];

  constructor(initial: GameState) {
    validateGameState(initial);
    this.state = initial;
  }

  getState(): GameState {
    return this.state;
  }

  dispatch(event: GameEvent): GameState {
    const before = this.state;
    const reduced = attempt(() => {
      const next = reduce(before, event);
      validateGameState(next);
      return next;
    });
    if (!reduced.ok) {
      this.reportFailure(
        reduced.error instanceof StateInvariantError ? "invariant" : "reducer",
        reduced.error,
        true,
        event,
      );
      return before;
    }
    this.state = reduced.value;
    this.pushJournal({
      at: new Date().toISOString(),
      kind: "dispatch",
      event: event.type,
      before: summarizeState(before),
      after: summarizeState(reduced.value),
    });
    for (const listener of this.listeners) listener(this.state);
    return this.state;
  }

  getDebugJournal(): readonly DebugJournalEntry[] {
    return this.journal.slice();
  }

  reportFailure(
    category: IncidentCategory,
    error: unknown,
    fatal: boolean,
    event?: GameEvent,
  ): GameIncident {
    const incident = createGameIncident(
      category,
      error,
      this.state,
      this.getDebugJournal(),
      fatal,
      eventName(event),
    );
    this.pushJournal({
      at: incident.occurredAt,
      kind: category === "invariant" ? "invariant" : "failure",
      ...(incident.triggeringEvent ? { event: incident.triggeringEvent } : {}),
      message: incident.message,
      before: summarizeState(this.state),
    });
    incident.journal = this.getDebugJournal();
    for (const listener of this.incidentListeners) listener(incident);
    return incident;
  }

  subscribeIncidents(listener: IncidentListener): () => void {
    this.incidentListeners.add(listener);
    return () => {
      this.incidentListeners.delete(listener);
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private pushJournal(entry: DebugJournalEntry): void {
    this.journal.push(entry);
    if (this.journal.length > DEBUG_JOURNAL_LIMIT) this.journal.shift();
  }
}
