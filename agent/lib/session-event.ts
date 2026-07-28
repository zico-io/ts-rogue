import type { HookEventMap } from "eve/hooks";

// eve's own event payloads; the unions behind them are reached structurally
// because eve does not export them by name.

export type ActionsRequestedData = HookEventMap["actions.requested"]["data"];
export type ActionResultData = HookEventMap["action.result"]["data"];
export type InputRequestedData = HookEventMap["input.requested"]["data"];

/** One action the harness asked to run: load-skill, tool, subagent, or remote agent. */
export type ActionRequest = ActionsRequestedData["actions"][number];

/** One completed action's outcome. */
export type ActionResult = ActionResultData["result"];

/** One request for human input, passed through to a channel untouched. */
export type InputRequest = InputRequestedData["requests"][number];

/** Why an assistant message ended; `"tool-calls"` means a tool call follows it. */
export type MessageFinishReason =
  HookEventMap["message.completed"]["data"]["finishReason"];

/** How a connection authorization resolved. */
export type AuthorizationOutcome =
  HookEventMap["authorization.completed"]["data"]["outcome"];
