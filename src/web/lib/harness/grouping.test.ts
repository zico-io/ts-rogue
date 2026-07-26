import { describe, expect, it } from "vitest";
import { buildSessionTree, summarizeRootSessions } from "./grouping";
import type { HarnessRunRecord } from "./types";

function record(overrides: Partial<HarnessRunRecord>): HarnessRunRecord {
  return {
    rootId: "sess-1",
    parentId: null,
    type: "session",
    subagent: null,
    trigger: "linear",
    title: "HAR-50",
    model: null,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    toolCount: 0,
    status: "running",
    ...overrides,
  };
}

describe("summarizeRootSessions", () => {
  it("aggregates token totals across a root and every run under it", () => {
    const summaries = summarizeRootSessions([
      record({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 5 }),
      record({
        subagent: "coder",
        inputTokens: 300,
        outputTokens: 80,
        cacheReadTokens: 15,
      }),
    ]);

    expect(summaries).toEqual([
      {
        id: "sess-1",
        title: "HAR-50",
        trigger: "linear",
        status: "running",
        inputTokens: 400,
        outputTokens: 100,
        cacheReadTokens: 20,
      },
    ]);
  });

  it("groups independently by root, one summary per root session", () => {
    const summaries = summarizeRootSessions([
      record({ rootId: "sess-1" }),
      record({ rootId: "sess-2", title: "Other" }),
    ]);
    expect(summaries.map((s) => s.id).sort()).toEqual(["sess-1", "sess-2"]);
  });

  it("drops rows with no root id (unattributable data)", () => {
    expect(summarizeRootSessions([record({ rootId: "" })])).toEqual([]);
  });

  it("derives failed status when any run under the root failed", () => {
    const [summary] = summarizeRootSessions([
      record({ status: "completed" }),
      record({ subagent: "coder", status: "failed" }),
    ]);
    expect(summary.status).toBe("failed");
  });

  it("derives completed status only when every run under the root completed", () => {
    const [summary] = summarizeRootSessions([
      record({ status: "completed" }),
      record({ subagent: "coder", status: "completed" }),
    ]);
    expect(summary.status).toBe("completed");
  });

  it("derives running status when nothing has failed/cancelled/fully completed", () => {
    const [summary] = summarizeRootSessions([
      record({ status: "completed" }),
      record({ subagent: "coder", status: "running" }),
    ]);
    expect(summary.status).toBe("running");
  });
});

describe("buildSessionTree", () => {
  it("returns null when the root id has no matching records", () => {
    expect(
      buildSessionTree("missing", [record({ rootId: "sess-1" })]),
    ).toBeNull();
  });

  it("aggregates the root's own turns and one child per subagent role", () => {
    const tree = buildSessionTree("sess-1", [
      record({ type: "turn", inputTokens: 10, outputTokens: 5, toolCount: 1 }),
      record({ type: "turn", inputTokens: 20, outputTokens: 5, toolCount: 2 }),
      record({
        type: "subagent",
        subagent: "coder",
        model: "gpt",
        inputTokens: 100,
        outputTokens: 30,
        toolCount: 4,
        status: "completed",
      }),
      record({
        type: "subagent",
        subagent: "reviewer",
        inputTokens: 40,
        outputTokens: 10,
        toolCount: 2,
        status: "failed",
      }),
    ]);

    expect(tree).toEqual({
      id: "sess-1",
      type: "session",
      subagent: null,
      model: null,
      inputTokens: 30,
      outputTokens: 10,
      cacheReadTokens: 0,
      toolCount: 3,
      status: "failed",
      children: [
        {
          id: "sess-1:coder",
          type: "subagent",
          subagent: "coder",
          model: "gpt",
          inputTokens: 100,
          outputTokens: 30,
          cacheReadTokens: 0,
          toolCount: 4,
          status: "completed",
          children: [],
        },
        {
          id: "sess-1:reviewer",
          type: "subagent",
          subagent: "reviewer",
          model: null,
          inputTokens: 40,
          outputTokens: 10,
          cacheReadTokens: 0,
          toolCount: 2,
          status: "failed",
          children: [],
        },
      ],
    });
  });

  it("sorts subagent children by name for deterministic output", () => {
    const tree = buildSessionTree("sess-1", [
      record({ type: "subagent", subagent: "scout" }),
      record({ type: "subagent", subagent: "coder" }),
    ]);
    expect(tree?.children.map((c) => c.subagent)).toEqual(["coder", "scout"]);
  });

  it("ignores records from other root sessions", () => {
    const tree = buildSessionTree("sess-1", [
      record({ rootId: "sess-1", subagent: "coder" }),
      record({ rootId: "sess-2", subagent: "other" }),
    ]);
    expect(tree?.children).toHaveLength(1);
    expect(tree?.children[0]?.subagent).toBe("coder");
  });
});
