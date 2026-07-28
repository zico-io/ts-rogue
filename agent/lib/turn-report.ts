import { isPlainObject } from "./narrow";
import { firstNonEmptyLine } from "./prose";
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

interface FailureData {
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

/**
 * An unrecoverable session needs a fresh session, not a retry. How a human
 * starts that fresh session is the channel's own wording, so it is passed in.
 */
export const sessionFailureBody = (
  data: FailureData,
  restartHint: string,
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

// biome-ignore lint/suspicious/noExplicitAny: mirrors the union of runtime action request shapes (load-skill / remote-agent-call / subagent-call / tool-call)
export const actionLabel = (action: any): string =>
  action.kind === "tool-call" && action.toolName
    ? toolLabel(action.toolName)
    : action.kind;

// biome-ignore lint/suspicious/noExplicitAny: see actionLabel
export const actionParameter = (action: any): string => {
  if (action.kind === "subagent-call" && typeof action.input === "object") {
    const message = action.input?.message;
    if (typeof message === "string") {
      const lead = firstNonEmptyLine(message);
      if (lead) return lead;
    }
  }
  if (action.kind === "tool-call" && action.toolName) {
    return toolActionParameter(action.toolName, action.input);
  }
  if (action.description) return action.description;
  if (action.name) return action.name;
  if (action.input !== undefined) {
    try {
      return JSON.stringify(action.input);
    } catch {
      return "";
    }
  }
  return "";
};

/** The human-readable outcome of a completed action, error message first. */
export const actionResultText = (data: {
  readonly error?: { readonly message?: string } | null;
  // biome-ignore lint/suspicious/noExplicitAny: mirrors the union of runtime action result shapes
  readonly result: any;
}): string => {
  if (data.error?.message) return data.error.message;
  if (data.result.kind === "tool-result") {
    return toolActionResult(
      data.result.toolName,
      data.result.output,
      data.result.isError,
    );
  }
  try {
    // `JSON.stringify(undefined)` is `undefined`, not a string.
    return JSON.stringify(data.result.output) ?? "";
  } catch {
    return "";
  }
};
