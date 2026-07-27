import { describe, expect, it } from "vitest";
import { EVE_TAG } from "./eveTags";
import { mapRowsToRunRecords } from "./runRecords";
import type { ObservabilityRow } from "./vercelObservability";

function row(tags: Record<string, string>): ObservabilityRow {
  return { tags, value: 1 };
}

describe("mapRowsToRunRecords", () => {
  it("reads every tag and defaults missing numeric tags to 0", () => {
    const [record] = mapRowsToRunRecords([
      row({
        [EVE_TAG.root]: "sess-1",
        [EVE_TAG.parent]: "",
        [EVE_TAG.type]: "session",
        [EVE_TAG.trigger]: "linear",
        [EVE_TAG.title]: "HAR-50",
        [EVE_TAG.model]: "claude",
        [EVE_TAG.inputTokens]: "120",
        [EVE_TAG.outputTokens]: "45",
        [EVE_TAG.cacheReadTokens]: "10",
        [EVE_TAG.toolCount]: "3",
      }),
    ]);

    expect(record).toEqual({
      rootId: "sess-1",
      parentId: null,
      type: "session",
      subagent: null,
      trigger: "linear",
      title: "HAR-50",
      model: "claude",
      inputTokens: 120,
      outputTokens: 45,
      cacheReadTokens: 10,
      toolCount: 3,
      status: "running",
    });
  });

  it("treats an unrecognized $eve.type as a session (defensive default)", () => {
    const [record] = mapRowsToRunRecords([row({ [EVE_TAG.type]: "bogus" })]);
    expect(record.type).toBe("session");
  });

  it("marks a run completed/failed/cancelled from the matching completion set", () => {
    const rows = [
      row({ [EVE_TAG.root]: "sess-1", [EVE_TAG.subagent]: "coder" }),
      row({ [EVE_TAG.root]: "sess-1", [EVE_TAG.subagent]: "reviewer" }),
      row({ [EVE_TAG.root]: "sess-1", [EVE_TAG.subagent]: "scout" }),
    ];

    const records = mapRowsToRunRecords(rows, {
      completed: new Set(["sess-1:coder"]),
      failed: new Set(["sess-1:reviewer"]),
      cancelled: new Set(["sess-1:unrelated"]),
    });

    expect(records.map((record) => record.status)).toEqual([
      "completed",
      "failed",
      "running",
    ]);
  });

  it("prioritizes failed over cancelled over completed for the same run", () => {
    const [record] = mapRowsToRunRecords([row({ [EVE_TAG.root]: "sess-1" })], {
      completed: new Set(["sess-1:"]),
      failed: new Set(["sess-1:"]),
      cancelled: new Set(["sess-1:"]),
    });
    expect(record.status).toBe("failed");
  });
});
