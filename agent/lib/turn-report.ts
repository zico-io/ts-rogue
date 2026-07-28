import { isPlainObject } from "./narrow";
import { firstNonEmptyLine } from "./prose";
import type { ActionRequest, ActionResultData } from "./session-event";
import {
  toolActionParameter,
  toolActionResult,
  toolLabel,
} from "./tool-activity";
import { truncate } from "./truncate";

/** How much of an error message an inline parenthetical carries. */
const ERROR_HINT_MAX = 160;

const errorId = (details: unknown): string | undefined =>
  isPlainObject(details) &&
  typeof details.errorId === "string" &&
  details.errorId.length > 0
    ? details.errorId
    : undefined;

const errorHint = (data: {
  readonly details?: unknown;
  readonly message: string;
}): string => {
  const name =
    isPlainObject(data.details) && typeof data.details.name === "string"
      ? data.details.name
      : undefined;
  const message = data.message.trim();
  if (name && message.length > 0)
    return ` (${name}: ${truncate(message, ERROR_HINT_MAX)})`;
  if (name) return ` (${name})`;
  if (message.length > 0) return ` (${truncate(message, ERROR_HINT_MAX)})`;
  return "";
};

/** What eve reports about a failed turn or a dead session. */
export interface FailureData {
  readonly details?: unknown;
  readonly message: string;
}

const failureBody = (
  data: FailureData,
  lead: string,
  guidance: string,
): string => {
  const id = errorId(data.details);
  return [
    `${lead}${errorHint(data)}.`,
    "",
    guidance,
    ...(id ? ["", `Error id: ${id}`] : []),
  ].join("\n");
};

/** An unrecoverable session needs a fresh one; the restart wording is the channel's. */
export const sessionFailureBody = (
  data: FailureData,
  restartHint = "Start a new conversation to continue.",
): string =>
  failureBody(
    data,
    "This session could not recover from an error",
    restartHint,
  );

export const turnFailureBody = (data: FailureData): string =>
  failureBody(
    data,
    "I hit an error while handling your request",
    "Please try again, rephrase, or reach out if it keeps failing.",
  );

export const actionLabel = (action: ActionRequest): string =>
  action.kind === "tool-call" ? toolLabel(action.toolName) : action.kind;

export const actionParameter = (action: ActionRequest): string => {
  if (action.kind === "subagent-call") {
    const message = action.input.message;
    if (typeof message === "string") {
      const lead = firstNonEmptyLine(message);
      if (lead) return lead;
    }
  }
  if (action.kind === "tool-call") {
    return toolActionParameter(action.toolName, action.input);
  }
  if ("description" in action) return action.description;
  return JSON.stringify(action.input);
};

/** The human-readable outcome of a completed action, error message first. */
export const actionResultText = (
  data: Pick<ActionResultData, "error" | "result">,
): string => {
  if (data.error?.message) return data.error.message;
  if (data.result.kind === "tool-result") {
    return toolActionResult(
      data.result.toolName,
      data.result.output,
      data.result.isError,
    );
  }
  return JSON.stringify(data.result.output);
};
