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

export function dungeonWaypointId(entranceIndex: number): string {
  return `dungeon-${entranceIndex}`;
}

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

export function findWaypoint(
  map: OverworldMap,
  id: string,
): Waypoint | undefined {
  return allWaypoints(map).find((waypoint) => waypoint.id === id);
}

export function activatedWaypointList(
  map: OverworldMap,
  activatedIds: readonly string[],
): Waypoint[] {
  return allWaypoints(map).filter((waypoint) =>
    activatedIds.includes(waypoint.id),
  );
}

export function activateWaypoint(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? [...ids] : [...ids, id];
}
