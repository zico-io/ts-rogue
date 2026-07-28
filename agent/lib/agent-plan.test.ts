import { describe, expect, it } from "vitest";

import { planFromActionResult, planFromTodoToolOutput } from "./agent-plan";

describe("planFromTodoToolOutput", () => {
  it("maps todo tool output into Linear plan entries", () => {
    expect(
      planFromTodoToolOutput({
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

  it("drops malformed entries and returns null for a non-object output", () => {
    expect(
      planFromTodoToolOutput({
        todos: [
          { content: "ok", status: "pending" },
          { content: 42, status: "pending" },
          { content: "bad status", status: "unknown" },
        ],
      }),
    ).toEqual([{ content: "ok", status: "pending" }]);
    expect(planFromTodoToolOutput("not an object")).toBeNull();
    expect(planFromTodoToolOutput({})).toBeNull();
  });
});

describe("planFromActionResult", () => {
  const todoResult = (overrides: Record<string, unknown> = {}) => ({
    status: "completed",
    result: {
      kind: "tool-result",
      toolName: "todo",
      output: {
        todos: [
          { content: "Ship it", priority: "high", status: "in_progress" },
        ],
      },
      ...overrides,
    },
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
        result: { kind: "tool-result", toolName: "bash", output: {} },
      }),
    ).toBeNull();
  });

  it("ignores a failed or errored todo call", () => {
    expect(
      planFromActionResult({
        status: "failed",
        result: {
          kind: "tool-result",
          toolName: "todo",
          output: { todos: [] },
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
          kind: "tool-result",
          toolName: "todo",
          output: { todos: [] },
        },
      }),
    ).toBeNull();
  });

  it("ignores a non-tool result kind", () => {
    expect(
      planFromActionResult({
        status: "completed",
        result: { kind: "subagent-result", output: { todos: [] } },
      }),
    ).toBeNull();
  });
});
