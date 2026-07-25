/**
 * Fast-travel waypoint registry (ENG-1). A waypoint is a landmark the party
 * can teleport to once it has visited that landmark this run. Today the only
 * landmark sources in the codebase are `OverworldMap.village` (a single
 * point) and `OverworldMap.dungeonEntrances` (a fixed array of points), so
 * `allWaypoints` derives the whole registry from exactly those two existing
 * fields - nothing new is generated or stored on `OverworldMap` itself.
 *
 * ponytail: story dungeons (ROG-27), random dungeons/delves (ROG-35), and
 * item-world checkpoints (ROG-28) will each add their own landmark kind once
 * their world data exists; `WaypointKind` and `allWaypoints` are the
 * extension point for that, not stubbed out ahead of time (YAGNI) since none
 * of that world data exists yet.
 */

import type { OverworldMap, Point } from "./types";

export type WaypointKind = "village" | "dungeonEntrance";

export interface Waypoint {
  id: string;
  kind: WaypointKind;
  label: string;
  tier: number;
  point: Point;
}

export const VILLAGE_WAYPOINT_ID = "village";

/**
 * The waypoint id for a dungeon entrance at `entranceIndex`. This must match
 * (and is the single source of truth for) the `dungeonId` string
 * `moveOverworld` builds for `state.dungeonState.dungeonId` when the party
 * steps onto that entrance, so both call sites derive it from here instead
 * of duplicating the template.
 */
export function dungeonWaypointId(entranceIndex: number): string {
  return `dungeon-${entranceIndex}`;
}

/**
 * Every waypoint derivable from `map`, in a stable registry order: the
 * village first (tier 0), then one entry per dungeon entrance (tier
 * `index + 1`).
 */
export function allWaypoints(map: OverworldMap): Waypoint[] {
  const waypoints: Waypoint[] = [
    {
      id: VILLAGE_WAYPOINT_ID,
      kind: "village",
      label: "Village",
      tier: 0,
      point: map.village,
    },
  ];
  map.dungeonEntrances.forEach((point, index) => {
    waypoints.push({
      id: dungeonWaypointId(index),
      kind: "dungeonEntrance",
      label: `Dungeon ${index + 1}`,
      tier: index + 1,
      point,
    });
  });
  return waypoints;
}

/** Looks up a single waypoint by id, if it exists in `map`'s registry. */
export function findWaypoint(
  map: OverworldMap,
  id: string,
): Waypoint | undefined {
  return allWaypoints(map).find((waypoint) => waypoint.id === id);
}

/**
 * `allWaypoints(map)` filtered down to the ids in `activatedIds`, preserving
 * the registry's order (not the activation order).
 */
export function activatedWaypointList(
  map: OverworldMap,
  activatedIds: readonly string[],
): Waypoint[] {
  return allWaypoints(map).filter((waypoint) =>
    activatedIds.includes(waypoint.id),
  );
}

/** Appends `id` to `ids` if not already present; pure, dedupes, no mutation. */
export function activateWaypoint(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? [...ids] : [...ids, id];
}
