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
import { FIELD_BACKPACK_CAP, isFieldBackpackFull } from "../loot/inventory";
import { describeItem, itemSellPrice } from "../loot/items";
import { EMPTY_LOOT_FILTER, type LootFilterRules } from "../loot/lootFilter";
import {
  applyLootPickupWithFilter,
  buildLootFilterContext,
  lootLogEntries,
  queueLootTriage,
} from "../loot/pickup";
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

export const INN_COST_PER_MEMBER = 10;

export interface NewGameOptions {
  permadeath?: boolean;

  classId?: string;

  name?: string;
}

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
    nextItemId: 1,
    activatedWaypoints: activateWaypoint([], VILLAGE_WAYPOINT_ID),
    worldState: createInitialWorldState(map),
    dungeonState: null,
    battleState: null,
    flags: { permadeath: options?.permadeath ?? false, gameOver: false },
    stash: [],
    pendingLootTriage: null,
    lootFilter: EMPTY_LOOT_FILTER,
    lastLootOutcome: null,
  };

  return rollRecruits(base);
}

function rollRecruits(state: GameState): GameState {
  const rng = new Rng(state.seed, state.rngState);
  const recruits = generateRecruits(rng, state.party[0]?.level ?? 1);
  return { ...state, recruits, rngState: rng.getState() };
}

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

function turnDungeon(state: GameState, direction: TurnDirection): GameState {
  const ds = state.dungeonState;
  if (!ds) return state;
  return {
    ...state,
    dungeonState: { ...ds, facing: rotateFacing(ds.facing, direction) },
  };
}

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

  return { ...state, dungeonState: moved };
}

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

  const rng = new Rng(state.seed, state.rngState);
  const chest = rollChestLoot(rng, ds.floor, state.nextItemId, ds.dungeonId);

  const filterContext = buildLootFilterContext(state.party, ds.floor);
  const pickup = applyLootPickupWithFilter(
    state.items,
    chest.items,
    FIELD_BACKPACK_CAP,
    state.lootFilter,
    filterContext,
  );
  const pendingLootTriage = queueLootTriage(
    state.pendingLootTriage,
    pickup.queued,
  );
  // ENG-20: base chest loot line (fixed drops, no rarity), then the shared
  // kept/dismantle lines (`lootLogEntries`, also used by battle victory's
  // `finalizeWon`), then the triage-full line if the backpack overflowed.
  const baseLine = entry(chestLootMessage(loot), "loot");
  const triageLines = pickup.queued.length
    ? [
        entry(
          `Your backpack is full - ${pickup.queued.length} item(s) await a swap-or-dismantle decision`,
          "loot",
        ),
      ]
    : [];
  const logs = [
    ...state.log,
    baseLine,
    ...lootLogEntries(pickup.outcome),
    ...triageLines,
  ];
  return {
    ...state,
    rngState: rng.getState(),
    gold: state.gold + loot.gold + pickup.outcome.goldGained,
    inventory,
    items: pickup.items,
    nextItemId: chest.nextId,
    dungeonState: { ...ds, layout },
    pendingLootTriage,
    lastLootOutcome: pickup.outcome,
    log: logs,
  };
}

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

function applyFieldItemUse(
  state: GameState,
  itemId: string,
  memberId: string,
): GameState {
  if (state.scene === "battle") {
    return {
      ...state,
      log: [...state.log, entry("Use battle items from the battle menu")],
    };
  }
  const owned = state.inventory.find((item) => item.itemId === itemId);
  if (!owned || owned.quantity <= 0 || !isHealItem(itemId)) {
    return {
      ...state,
      log: [...state.log, entry("That item cannot be used here")],
    };
  }
  const memberIndex = state.party.findIndex((m) => m.id === memberId);
  if (memberIndex === -1) {
    return {
      ...state,
      log: [...state.log, entry("No such party member")],
    };
  }
  const member = state.party[memberIndex];
  if (member.hp <= 0) {
    return {
      ...state,
      log: [
        ...state.log,
        entry(`${member.name} is down and cannot be healed by items`),
      ],
    };
  }
  const heal = healAmount(itemId);
  const recovered = Math.min(heal, member.maxHp - member.hp);
  if (recovered <= 0) {
    return {
      ...state,
      log: [...state.log, entry(`${member.name} is already at full health`)],
    };
  }
  const party = state.party.map((entry, index) =>
    index === memberIndex ? { ...entry, hp: entry.hp + recovered } : entry,
  );
  const name = findShopItem(itemId)?.name ?? itemId;
  return {
    ...state,
    party,
    inventory: consumeItem(state.inventory, itemId),
    log: [
      ...state.log,
      entry(`${member.name} uses ${name} and recovers ${recovered} HP.`),
    ],
  };
}

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

function nextMemberId(party: readonly PartyMember[]): string {
  const maxSuffix = party.reduce((max, member) => {
    const n = Number.parseInt(member.id.replace(/^\D+/, ""), 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return `member-${maxSuffix + 1}`;
}

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

function depositItem(state: GameState, instanceId: string): GameState {
  const item = state.items.find((entry) => entry.instanceId === instanceId);
  if (!item) {
    return {
      ...state,
      log: [...state.log, entry("There is nothing to stash")],
    };
  }
  return {
    ...state,
    items: state.items.filter((entry) => entry.instanceId !== instanceId),
    stash: [...state.stash, item],
    log: [...state.log, entry(`Stashed ${describeItem(item)}.`, "loot")],
  };
}

function withdrawItem(state: GameState, instanceId: string): GameState {
  const item = state.stash.find((entry) => entry.instanceId === instanceId);
  if (!item) {
    return {
      ...state,
      log: [...state.log, entry("There is nothing to withdraw")],
    };
  }
  if (isFieldBackpackFull(state.items)) {
    return {
      ...state,
      log: [
        ...state.log,
        entry(
          `Backpack is full (${FIELD_BACKPACK_CAP}/${FIELD_BACKPACK_CAP}) - stash or dismantle something first`,
        ),
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

function resolveLootTriage(
  state: GameState,
  event: Extract<GameEvent, { type: "ResolveLootTriage" }>,
): GameState {
  const pending = state.pendingLootTriage;
  if (!pending || pending.drops.length === 0) {
    return {
      ...state,
      log: [...state.log, entry("There is nothing awaiting triage")],
    };
  }
  const [drop, ...restDrops] = pending.drops;
  const nextPending = restDrops.length ? { drops: restDrops } : null;

  if (event.action === "dismantleDrop") {
    const proceeds = itemSellPrice(drop);
    return {
      ...state,
      gold: state.gold + proceeds,
      pendingLootTriage: nextPending,
      log: [
        ...state.log,
        entry(`Dismantled ${describeItem(drop)} for ${proceeds} gold.`, "loot"),
      ],
    };
  }

  const carried = state.items.find(
    (entry) => entry.instanceId === event.instanceId,
  );
  if (!carried) {
    return {
      ...state,
      log: [...state.log, entry("There is nothing to dismantle")],
    };
  }
  const proceeds = itemSellPrice(carried);
  const items = [
    ...state.items.filter((entry) => entry.instanceId !== event.instanceId),
    drop,
  ];
  return {
    ...state,
    gold: state.gold + proceeds,
    items,
    pendingLootTriage: nextPending,
    log: [
      ...state.log,
      entry(
        `Dismantled ${describeItem(carried)} for ${proceeds} gold.`,
        "loot",
      ),
    ],
  };
}

function setLootFilter(state: GameState, rules: LootFilterRules): GameState {
  return { ...state, lootFilter: rules };
}

/** Pure state transition. Rejected events return the original state unchanged. */
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
    case "UseFieldItem":
      return applyFieldItemUse(state, event.itemId, event.memberId);
    case "DepositItem":
      return depositItem(state, event.instanceId);
    case "WithdrawItem":
      return withdrawItem(state, event.instanceId);
    case "ResolveLootTriage":
      return resolveLootTriage(state, event);
    case "SetLootFilter":
      return setLootFilter(state, event.rules);
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

/** Validates transitions and preserves the prior state when a reducer fails. */
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
