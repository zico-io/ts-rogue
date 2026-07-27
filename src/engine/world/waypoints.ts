import { DUNGEONS, type DungeonDef } from "../../data/dungeons";
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

// Fixed entrance slots are assigned story dungeons in ascending tier order.
// overworld.ts sorts dungeonEntrances near-to-far from the village, so
// entrance index 0 is nearest and gets the lowest-tier dungeon.
const STORY_DUNGEONS_NEAR_TO_FAR: readonly DungeonDef[] = [...DUNGEONS].sort(
  (a, b) => a.tier - b.tier,
);

export function storyDungeonForEntrance(
  entranceIndex: number,
): DungeonDef | undefined {
  return STORY_DUNGEONS_NEAR_TO_FAR[entranceIndex];
}

export function dungeonWaypointId(entranceIndex: number): string {
  return (
    storyDungeonForEntrance(entranceIndex)?.id ?? `dungeon-${entranceIndex}`
  );
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
