import { findClass } from "../../data/classes";
import { chestLootFor, chestLootMessage } from "../../data/dungeons";
import { findShopItem, sellPriceFor } from "../../data/shops";
import { resolveBattleEvent, startBattle } from "../combat/resolution";
import type { InventoryItem, PartyMember } from "../entities/party";
import { createStartingHero, MAX_PARTY } from "../entities/party";
import {
  generateRecruits,
  recruitClassName,
  recruitCost,
} from "../entities/recruits";
import { consumeItem, healAmount, isHealItem } from "../loot/consumables";
import { type EquipmentSlotName, equipTargetSlot } from "../loot/equipment";
import { FIELD_BACKPACK_CAP, maxPartyLevel } from "../loot/inventory";
import { describeItem, itemSellPrice } from "../loot/items";
import {
  DEFAULT_LOOT_FILTER,
  type LootFilterSettings,
} from "../loot/lootFilter";
import { applyLootPickup } from "../loot/pickup";
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
  activateWaypoint,
  dungeonWaypointId,
  findWaypoint,
  VILLAGE_WAYPOINT_ID,
} from "../world/waypoints";
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
  /** Player-chosen name for the starting hero; defaults to "Hero" when omitted. */
  name?: string;
}

/** Build a fresh state tree for a new run from a seed, logging the seed. */
export function newGame(seed: number, options?: NewGameOptions): GameState {
  const rng = new Rng(seed);
  const map = generateOverworldMap(seed);
  const base: GameState = {
    seed,
    rngState: rng.getState(),
    scene: "village",
    log: [entry(`Started new game with seed ${seed}`, "quest")],
    party: [createStartingHero(options?.classId, "hero-1", options?.name)],
    recruits: [],
    gold: 50,
    inventory: [],
    items: [],
    stash: [],
    nextItemId: 1,
    lootFilter: DEFAULT_LOOT_FILTER,
    pendingLootTriage: null,
    activatedWaypoints: activateWaypoint([], VILLAGE_WAYPOINT_ID),
    worldState: createInitialWorldState(map),
    dungeonState: null,
    battleState: null,
    flags: { permadeath: options?.permadeath ?? false, gameOver: false },
  };
  // Populate the tavern immediately so a fresh run has recruits to hire.
  return rollRecruits(base);
}

/**
 * Reroll the tavern recruit pool from the current RNG stream (ROG-21). Called
 * on new game and on inn rest (the chosen rotation cadence). Consumes RNG, so
 * the advanced `rngState` is persisted for deterministic replays/saves.
 */
function rollRecruits(state: GameState): GameState {
  const rng = new Rng(state.seed, state.rngState);
  const recruits = generateRecruits(rng, state.party[0]?.level ?? 1);
  return { ...state, recruits, rngState: rng.getState() };
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
  const healed: GameState = {
    ...state,
    gold: state.gold - cost,
    party: state.party.map((member) => ({
      ...member,
      hp: member.maxHp,
      mp: member.maxMp,
    })),
    log: [...state.log, entry(`Healed the party for ${cost} gold`)],
  };
  // Resting is the tavern rotation cadence (ROG-21): fresh faces after each rest.
  return rollRecruits(healed);
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
    const dungeonId = dungeonWaypointId(entranceIndex);
    return {
      ...state,
      scene: "dungeon",
      worldState: { ...state.worldState, player: target },
      dungeonState: createInitialDungeonState(state.seed, dungeonId, 1),
      activatedWaypoints: activateWaypoint(state.activatedWaypoints, dungeonId),
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
  const pickup = applyLootPickup(
    state.items,
    chest.items,
    state.lootFilter,
    maxPartyLevel(state.party),
  );
  let message = chestLootMessage(loot);
  if (pickup.kept.length > 0) {
    message = `${message.replace(/!$/, "")}, plus ${describeItem(pickup.kept[0])}!`;
  }
  const logs: LogEntry[] = [entry(message, "loot")];
  // ponytail: a log-line summary is the loot toast for now - `MessageLog`
  // colors a whole line by `LogKind`, not per-substring, so it can't
  // rarity-color each item within one line. A dedicated rarity-swatched
  // toast widget is the upgrade path if this needs richer visuals later.
  if (pickup.dismantled.length > 0 || pickup.pendingLootTriage) {
    logs.push(
      entry(
        `Loot: kept ${pickup.kept.length}, dismantled ${pickup.dismantled.length} -> ${pickup.gold}g`,
        "loot",
      ),
    );
  }
  return {
    ...state,
    rngState: rng.getState(),
    gold: state.gold + loot.gold + pickup.gold,
    inventory,
    items: pickup.items,
    pendingLootTriage: pickup.pendingLootTriage,
    nextItemId: chest.nextId,
    dungeonState: { ...ds, layout },
    log: [...state.log, ...logs],
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
 * `ExitDungeon` reducer (Phase 6, ROG-12; ENG-1 "evac"). Leaves the active
 * dungeon and returns the party to the overworld at the dungeon entrance
 * tile (which is where `worldState.player` was left when the party
 * entered). Clears `dungeonState` and any lingering `battleState`. This used
 * to also reset the overworld encounter meter as a "welcome back" grace;
 * ENG-1 deliberately removes that reset so evac (and `Zoom`, which reuses
 * the same no-encounter-reset contract) never grants a free danger-
 * accumulator reset - the meter carries over unchanged. This is the
 * dedicated exit path that prevents the dungeon from being a dead-end after
 * clearing a floor or defeating the boss.
 */
function exitDungeon(state: GameState): GameState {
  const ds = state.dungeonState;
  if (!ds) return state;
  return {
    ...state,
    scene: "overworld",
    worldState: { ...state.worldState },
    dungeonState: null,
    battleState: null,
    log: [...state.log, entry("You emerge from the dungeon", "quest")],
  };
}

/**
 * `Zoom` reducer (ENG-1 "fast travel"). Teleports the party to a landmark it
 * has already activated this run, from the overworld or village only -
 * inside a dungeon or battle the player must evac first. Deterministic: it
 * never touches `rngState`, `encounterMeter`, `dungeonState`, or
 * `battleState`, so it cannot itself trigger an encounter or grant a free
 * danger-accumulator reset.
 */
function zoom(state: GameState, waypointId: string): GameState {
  if (state.scene === "dungeon" || state.scene === "battle") {
    return {
      ...state,
      log: [...state.log, entry("Evac the dungeon before fast-traveling")],
    };
  }
  if (!state.activatedWaypoints.includes(waypointId)) {
    return {
      ...state,
      log: [
        ...state.log,
        entry("That destination has not been discovered yet"),
      ],
    };
  }
  const map = generateOverworldMap(state.seed);
  const waypoint = findWaypoint(map, waypointId);
  if (!waypoint) {
    return {
      ...state,
      log: [
        ...state.log,
        entry("That destination has not been discovered yet"),
      ],
    };
  }
  return {
    ...state,
    scene: waypoint.kind === "village" ? "village" : "overworld",
    worldState: { ...state.worldState, player: { ...waypoint.point } },
    log: [...state.log, entry(`You fast-travel to ${waypoint.label}`, "quest")],
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
  if (state.party.length >= MAX_PARTY) {
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

/** Next party-unique member id (`member-<n>`), avoiding collisions after dismiss/rehire. */
function nextMemberId(party: readonly PartyMember[]): string {
  const maxSuffix = party.reduce((max, member) => {
    const n = Number.parseInt(member.id.replace(/^\D+/, ""), 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return `member-${maxSuffix + 1}`;
}

/**
 * `HireRecruit` reducer (ROG-21). Moves the pool recruit at `index` into the
 * party for a level-scaled gold fee: blocked when the party is full or gold is
 * short (logs and no-ops, mirroring `storeBuy`). The recruit gets a fresh
 * party-unique id and is removed from the pool so it can't be hired twice.
 */
function hireRecruit(state: GameState, index: number): GameState {
  const recruit = state.recruits[index];
  if (!recruit) {
    return { ...state, log: [...state.log, entry("No such recruit")] };
  }
  if (state.party.length >= MAX_PARTY) {
    return {
      ...state,
      log: [...state.log, entry("The party is already full")],
    };
  }
  const cost = recruitCost(recruit.level);
  if (state.gold < cost) {
    return {
      ...state,
      log: [...state.log, entry(`Not enough gold to hire ${recruit.name}`)],
    };
  }
  const member: PartyMember = { ...recruit, id: nextMemberId(state.party) };
  return {
    ...state,
    gold: state.gold - cost,
    party: [...state.party, member],
    recruits: state.recruits.filter((_, i) => i !== index),
    log: [
      ...state.log,
      entry(
        `Hired ${member.name} the ${recruitClassName(member.classId)} for ${cost} gold!`,
        "quest",
      ),
    ],
  };
}

/**
 * `DismissMember` reducer (ROG-21). Removes a recruited member from the party.
 * The hero (the first member) is protected and can never be dismissed.
 */
function dismissMember(state: GameState, memberId: string): GameState {
  if (state.party[0]?.id === memberId) {
    return {
      ...state,
      log: [...state.log, entry("You cannot dismiss the hero")],
    };
  }
  const member = state.party.find((m) => m.id === memberId);
  if (!member) {
    return { ...state, log: [...state.log, entry("No such party member")] };
  }
  return {
    ...state,
    party: state.party.filter((m) => m.id !== memberId),
    log: [...state.log, entry(`Dismissed ${member.name} from the party`)],
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

/**
 * `DepositItem` reducer (ENG-2). Moves a field backpack item into the
 * unlimited village stash; symmetrical with `withdrawItem`.
 */
function depositItem(state: GameState, instanceId: string): GameState {
  const item = state.items.find((entry) => entry.instanceId === instanceId);
  if (!item) {
    return {
      ...state,
      log: [...state.log, entry("There is nothing to deposit")],
    };
  }
  return {
    ...state,
    items: state.items.filter((entry) => entry.instanceId !== instanceId),
    stash: [...state.stash, item],
    log: [...state.log, entry(`Stashed ${describeItem(item)}.`, "loot")],
  };
}

/**
 * `WithdrawItem` reducer (ENG-2). Moves a stashed item into the field
 * backpack, refusing (with a log line, no-op) when the field backpack is
 * already at `FIELD_BACKPACK_CAP`.
 */
function withdrawItem(state: GameState, instanceId: string): GameState {
  const item = state.stash.find((entry) => entry.instanceId === instanceId);
  if (!item) {
    return {
      ...state,
      log: [...state.log, entry("There is nothing to withdraw")],
    };
  }
  if (state.items.length >= FIELD_BACKPACK_CAP) {
    return {
      ...state,
      log: [
        ...state.log,
        entry("The field backpack is full - deposit or sell something first"),
      ],
    };
  }
  return {
    ...state,
    stash: state.stash.filter((entry) => entry.instanceId !== instanceId),
    items: [...state.items, item],
    log: [...state.log, entry(`Withdrew ${describeItem(item)}.`, "loot")],
  };
}

/**
 * `SetLootFilter` reducer (ENG-2). Replaces the auto-dismantle settings
 * wholesale - the Inventory screen's filter pane always sends the full
 * updated object back rather than a partial patch.
 */
function setLootFilter(
  state: GameState,
  filter: LootFilterSettings,
): GameState {
  return { ...state, lootFilter: filter };
}

/**
 * `ResolveLootTriage` reducer (ENG-2). Answers a pending swap-or-dismantle
 * prompt raised when a field drop overflowed the backpack cap:
 * `dismantleDrop` sells the pending drop; `swap` sells a named carried item
 * and keeps the drop instead. Either way, any further drops queued behind
 * the resolved one are re-run through the filter/cap pipeline, which may
 * raise a new pending triage of its own. No-ops (with a log line) when
 * there is nothing pending, or `swap` names an item not in the backpack.
 */
function resolveLootTriage(
  state: GameState,
  action: { action: "dismantleDrop" } | { action: "swap"; instanceId: string },
): GameState {
  const pending = state.pendingLootTriage;
  if (!pending) {
    return {
      ...state,
      log: [...state.log, entry("There is nothing to resolve")],
    };
  }

  let items = state.items;
  let gold = state.gold;
  const logs: LogEntry[] = [];

  if (action.action === "dismantleDrop") {
    const proceeds = itemSellPrice(pending.drop);
    gold += proceeds;
    logs.push(
      entry(
        `Dismantled ${describeItem(pending.drop)} for ${proceeds} gold.`,
        "loot",
      ),
    );
  } else {
    const swapTarget = items.find(
      (entry) => entry.instanceId === action.instanceId,
    );
    if (!swapTarget) {
      return {
        ...state,
        log: [...state.log, entry("There is nothing to swap")],
      };
    }
    const proceeds = itemSellPrice(swapTarget);
    gold += proceeds;
    items = [
      ...items.filter((entry) => entry.instanceId !== action.instanceId),
      pending.drop,
    ];
    logs.push(
      entry(
        `Swapped out ${describeItem(swapTarget)} for ${describeItem(pending.drop)} (+${proceeds} gold).`,
        "loot",
      ),
    );
  }

  const continued = applyLootPickup(
    items,
    pending.queue,
    state.lootFilter,
    maxPartyLevel(state.party),
  );
  gold += continued.gold;
  const toastLogs = continued.kept.map((item) =>
    entry(`Looted ${describeItem(item)}!`, "loot"),
  );
  if (continued.dismantled.length > 0 || continued.pendingLootTriage) {
    toastLogs.push(
      entry(
        `Loot: kept ${continued.kept.length}, dismantled ${continued.dismantled.length} -> ${continued.gold}g`,
        "loot",
      ),
    );
  }

  return {
    ...state,
    gold,
    items: continued.items,
    pendingLootTriage: continued.pendingLootTriage,
    log: [...state.log, ...logs, ...toastLogs],
  };
}

/**
 * `UseFieldItem` reducer (ENG-2). Field-only heal item use (battle keeps
 * going through `BattleItem`/`resolveBattleEvent`, unchanged): no-ops with a
 * log line when in battle, the item isn't a recognized heal item, none are
 * owned, or `memberId` doesn't name a party member.
 */
function applyFieldItemUse(
  state: GameState,
  itemId: string,
  memberId: string,
): GameState {
  if (state.battleState !== null) {
    return {
      ...state,
      log: [...state.log, entry("Cannot use field items in battle")],
    };
  }
  if (!isHealItem(itemId)) {
    return { ...state, log: [...state.log, entry(`Cannot use ${itemId}`)] };
  }
  const owned = state.inventory.find((entry) => entry.itemId === itemId);
  if (!owned || owned.quantity <= 0) {
    return {
      ...state,
      log: [...state.log, entry(`You have no ${itemId} to use`)],
    };
  }
  const memberIndex = state.party.findIndex((m) => m.id === memberId);
  if (memberIndex === -1) {
    return { ...state, log: [...state.log, entry("No such party member")] };
  }
  const member = state.party[memberIndex];
  const healed = Math.min(member.maxHp, member.hp + healAmount(itemId));
  const applied = healed - member.hp;
  const party = state.party.map((entry, index) =>
    index === memberIndex ? { ...entry, hp: healed } : entry,
  );
  const itemName = findShopItem(itemId)?.name ?? itemId;
  return {
    ...state,
    party,
    inventory: consumeItem(state.inventory, itemId),
    log: [
      ...state.log,
      entry(`${member.name} uses ${itemName} and recovers ${applied} HP.`),
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
        name: event.name,
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
    case "DepositItem":
      return depositItem(state, event.instanceId);
    case "WithdrawItem":
      return withdrawItem(state, event.instanceId);
    case "SetLootFilter":
      return setLootFilter(state, event.filter);
    case "ResolveLootTriage":
      return resolveLootTriage(state, event);
    case "UseFieldItem":
      return applyFieldItemUse(state, event.itemId, event.memberId);
    case "RecruitMember":
      return recruitMember(state, event.classId);
    case "RefreshRecruits":
      return rollRecruits(state);
    case "HireRecruit":
      return hireRecruit(state, event.index);
    case "DismissMember":
      return dismissMember(state, event.memberId);
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
    case "Zoom":
      return zoom(state, event.waypointId);
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
