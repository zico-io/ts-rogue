import type { MockModelRequest, MockModelResponse } from "eve/evals";

// Scripted model for the delegation-path eval
// (evals/delegation/child-session-update.eval.ts). Installed on the agent only
// when EVE_EVAL_MOCK_MODEL is set (see agent.ts): the harness, authored tools,
// and hooks all run for real - only the language model is deterministic. The
// child is a copy of the same agent, so it inherits this mock and takes the
// child branch below.

export const MOCK_AGENT_SESSION_ID = "mock-agent-session-0001";
export const MOCK_ISSUE_ID = "ROG-999";
export const DELEGATION_TRIGGER = "run the delegation fixture";
/** Uncommon fixed port for the eval's mock Linear GraphQL server. */
export const MOCK_LINEAR_PORT = 47831;

// Matches child-relay's parseAgentSessionId/parseIssueId so the child hook
// captures both facts from the packet text alone.
const DELEGATION_PACKET = [
  `issue: ${MOCK_ISSUE_ID} - delegation fixture`,
  `agent_session_id: ${MOCK_AGENT_SESSION_ID}`,
  "",
  "You are the fixture child. Post exactly one session_update with status completed, then finish.",
].join("\n");

const hasToolResult = (request: MockModelRequest, name: string): boolean =>
  request.toolResults.some((result) => result.name.endsWith(name));

export const delegationResponder = (
  request: MockModelRequest,
): MockModelResponse => {
  const isRoot = request.userMessages.some((message) =>
    message.includes(DELEGATION_TRIGGER),
  );
  if (isRoot) {
    if (hasToolResult(request, "agent")) {
      return { text: "Delegation fixture complete." };
    }
    return {
      toolCalls: [{ name: "agent", input: { message: DELEGATION_PACKET } }],
    };
  }
  if (
    request.userMessages.some((message) =>
      message.includes(MOCK_AGENT_SESSION_ID),
    )
  ) {
    if (hasToolResult(request, "session_update")) {
      return { text: "Fixture child done." };
    }
    return {
      toolCalls: [
        {
          name: "session_update",
          input: {
            agentSessionId: MOCK_AGENT_SESSION_ID,
            message: "Fixture child finished the delegated work.",
            status: "completed",
          },
        },
      ],
    };
  }
  return { text: "Mock model: no fixture branch matched." };
};
