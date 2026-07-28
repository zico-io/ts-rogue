import type { HookEventMap } from "eve/hooks";

// eve's own payloads for the three lifecycle events whose shapes this agent
// reads into. `HookEventMap` is eve's explicit event-name to payload contract;
// the action unions behind it (`RuntimeActionRequest`, `RuntimeActionResult`,
// `InputRequest`) are not exported by name, so they are reached structurally.

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
