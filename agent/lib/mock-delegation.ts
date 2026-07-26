import type { MockModelRequest, MockModelResponse } from "eve/evals";

export const MOCK_AGENT_SESSION_ID = "mock-agent-session-0001";
export const MOCK_ISSUE_ID = "ROG-999";
export const DELEGATION_TRIGGER = "run the delegation fixture";

export const MOCK_LINEAR_PORT = 47831;

const DELEGATION_PACKET = [
  `issue: ${MOCK_ISSUE_ID} - delegation fixture`,
  `agent_session_id: ${MOCK_AGENT_SESSION_ID}`,
  "",
  "You are the fixture child. Post one session_update with status completed, then one with status blocked, then finish.",
].join("\n");

const toolResultCount = (request: MockModelRequest, name: string): number =>
  request.toolResults.filter((result) => result.name.endsWith(name)).length;

export const delegationResponder = (
  request: MockModelRequest,
): MockModelResponse => {
  const isRoot = request.userMessages.some((message) =>
    message.includes(DELEGATION_TRIGGER),
  );
  if (isRoot) {
    if (toolResultCount(request, "agent") > 0) {
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
    const posted = toolResultCount(request, "session_update");
    if (posted >= 2) return { text: "Fixture child done." };
    return {
      toolCalls: [
        {
          name: "session_update",
          input:
            posted === 0
              ? {
                  agentSessionId: MOCK_AGENT_SESSION_ID,
                  message: "Fixture child finished the delegated work.",
                  status: "completed",
                }
              : {
                  agentSessionId: MOCK_AGENT_SESSION_ID,
                  message: "Fixture child hit a wall.",
                  status: "blocked",
                },
        },
      ],
    };
  }
  return { text: "Mock model: no fixture branch matched." };
};
