import { isPlainObject } from "./narrow";
import type { ActionResultData } from "./session-event";

const TODO_STATUS_TO_PLAN_STATUS: Record<
  string,
  "pending" | "inProgress" | "completed" | "canceled"
> = {
  cancelled: "canceled",
  completed: "completed",
  in_progress: "inProgress",
  pending: "pending",
};

export interface PlanEntry {
  readonly content: string;
  readonly status: "pending" | "inProgress" | "completed" | "canceled";
}

const planFromTodoToolOutput = (output: unknown): readonly PlanEntry[] => {
  if (!isPlainObject(output) || !Array.isArray(output.todos)) return [];
  const entries: PlanEntry[] = [];
  for (const todo of output.todos) {
    if (!isPlainObject(todo)) continue;
    const status =
      typeof todo.status === "string"
        ? TODO_STATUS_TO_PLAN_STATUS[todo.status]
        : undefined;
    if (typeof todo.content !== "string" || status === undefined) continue;
    entries.push({ content: todo.content, status });
  }
  return entries;
};

/** The plan as of a completed action, or `null` when it carried no usable plan. */
export const planFromActionResult = (
  data: Pick<ActionResultData, "result" | "status">,
): readonly PlanEntry[] | null => {
  if (data.status !== "completed") return null;
  const { result } = data;
  if (
    result.kind !== "tool-result" ||
    result.toolName !== "todo" ||
    result.isError
  ) {
    return null;
  }
  const plan = planFromTodoToolOutput(result.output);
  return plan.length === 0 ? null : plan;
};
