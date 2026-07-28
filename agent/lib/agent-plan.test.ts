import { describe, expect, it } from "vitest";

import { planFromActionResult } from "./agent-plan";
import type { ActionResult, ActionResultData } from "./session-event";

describe("planFromActionResult", () => {
  const todoResult = (
    overrides: {
      readonly isError?: boolean;
      readonly output?: ActionResult["output"];
    } = {},
  ): Pick<ActionResultData, "result" | "status"> => ({
    result: {
      callId: "c1",
      kind: "tool-result",
      output: {
        todos: [
          { content: "Ship it", priority: "high", status: "in_progress" },
        ],
      },
      toolName: "todo",
      ...overrides,
    },
    status: "completed",
  });

  const planFrom = (output: ActionResult["output"]) =>
    planFromActionResult(todoResult({ output }));

  it("maps every todo status onto its Linear plan equivalent", () => {
    expect(
      planFrom({
        counts: {
          cancelled: 1,
          completed: 1,
          in_progress: 1,
          pending: 1,
          total: 4,
        },
        todos: [
          {
            content: "Read orientation",
            priority: "high",
            status: "completed",
          },
          {
            content: "Implement change",
            priority: "high",
            status: "in_progress",
          },
          { content: "Open PR", priority: "medium", status: "pending" },
          { content: "Skip this", priority: "low", status: "cancelled" },
        ],
      }),
    ).toEqual([
      { content: "Read orientation", status: "completed" },
      { content: "Implement change", status: "inProgress" },
      { content: "Open PR", status: "pending" },
      { content: "Skip this", status: "canceled" },
    ]);
  });

  it("drops malformed entries and ignores output that is not todo-shaped", () => {
    expect(
      planFrom({
        todos: [
          { content: "ok", status: "pending" },
          { content: 42, status: "pending" },
          { content: "bad status", status: "unknown" },
        ],
      }),
    ).toEqual([{ content: "ok", status: "pending" }]);
    expect(planFrom("not an object")).toBeNull();
    expect(planFrom({})).toBeNull();
  });

  it("returns the plan for a completed todo tool result", () => {
    expect(planFromActionResult(todoResult())).toEqual([
      { content: "Ship it", status: "inProgress" },
    ]);
  });

  it("ignores action results for tools other than todo", () => {
    expect(
      planFromActionResult({
        status: "completed",
        result: {
          callId: "c1",
          kind: "tool-result",
          output: {},
          toolName: "bash",
        },
      }),
    ).toBeNull();
  });

  it("ignores a failed or errored todo call", () => {
    expect(
      planFromActionResult({
        status: "failed",
        result: {
          callId: "c1",
          kind: "tool-result",
          output: { todos: [] },
          toolName: "todo",
        },
      }),
    ).toBeNull();
    expect(planFromActionResult(todoResult({ isError: true }))).toBeNull();
  });

  it("ignores an empty plan, which would blank out a real one", () => {
    expect(
      planFromActionResult({
        status: "completed",
        result: {
          callId: "c1",
          kind: "tool-result",
          output: { todos: [] },
          toolName: "todo",
        },
      }),
    ).toBeNull();
  });

  it("ignores a non-tool result kind", () => {
    expect(
      planFromActionResult({
        status: "completed",
        result: {
          callId: "c1",
          kind: "subagent-result",
          output: { todos: [] },
          subagentName: "agent",
        },
      }),
    ).toBeNull();
  });
});
