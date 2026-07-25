import { describe, expect, it } from "vitest";
import { generateOverworldMap } from "./overworld";
import {
  activatedWaypointList,
  activateWaypoint,
  allWaypoints,
  dungeonWaypointId,
  findWaypoint,
  VILLAGE_WAYPOINT_ID,
} from "./waypoints";

describe("allWaypoints", () => {
  it("includes the village first and every dungeon entrance with correct ids/tiers", () => {
    const map = generateOverworldMap(42);
    const waypoints = allWaypoints(map);

    expect(waypoints[0]).toEqual({
      id: VILLAGE_WAYPOINT_ID,
      kind: "village",
      label: "Village",
      tier: 0,
      point: map.village,
    });

    expect(waypoints).toHaveLength(map.dungeonEntrances.length + 1);
    map.dungeonEntrances.forEach((point, index) => {
      expect(waypoints[index + 1]).toEqual({
        id: dungeonWaypointId(index),
        kind: "dungeonEntrance",
        label: `Dungeon ${index + 1}`,
        tier: index + 1,
        point,
      });
    });
  });
});

describe("findWaypoint", () => {
  it("finds a waypoint by id and returns undefined for an unknown id", () => {
    const map = generateOverworldMap(42);
    expect(findWaypoint(map, VILLAGE_WAYPOINT_ID)?.kind).toBe("village");
    expect(findWaypoint(map, dungeonWaypointId(0))?.kind).toBe(
      "dungeonEntrance",
    );
    expect(findWaypoint(map, "not-a-waypoint")).toBeUndefined();
  });
});

describe("activatedWaypointList", () => {
  it("filters to activated ids and preserves registry order regardless of activation order", () => {
    const map = generateOverworldMap(42);
    const activatedIds = [dungeonWaypointId(0), VILLAGE_WAYPOINT_ID];
    const activated = activatedWaypointList(map, activatedIds);
    expect(activated.map((w) => w.id)).toEqual([
      VILLAGE_WAYPOINT_ID,
      dungeonWaypointId(0),
    ]);
  });

  it("returns an empty list when nothing is activated", () => {
    const map = generateOverworldMap(42);
    expect(activatedWaypointList(map, [])).toEqual([]);
  });
});

describe("activateWaypoint", () => {
  it("appends a new id", () => {
    expect(activateWaypoint([VILLAGE_WAYPOINT_ID], "dungeon-0")).toEqual([
      VILLAGE_WAYPOINT_ID,
      "dungeon-0",
    ]);
  });

  it("dedupes an already-activated id, returning an equivalent copy", () => {
    const ids = [VILLAGE_WAYPOINT_ID, "dungeon-0"];
    const result = activateWaypoint(ids, VILLAGE_WAYPOINT_ID);
    expect(result).toEqual(ids);
    expect(result).not.toBe(ids);
  });
});
