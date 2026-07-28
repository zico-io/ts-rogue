import { isPlainObject } from "./narrow";

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

/**
 * The agent's plan as of a completed action, or `null` when the action carried
 * no usable plan. Only a successful `todo` tool result sets the plan, and an
 * empty one is ignored rather than blanking out a real plan.
 */
export const planFromActionResult = (data: {
  readonly status?: string;
  // biome-ignore lint/suspicious/noExplicitAny: mirrors the union of runtime action result shapes
  readonly result: any;
}): readonly PlanEntry[] | null => {
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
