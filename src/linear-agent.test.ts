import { describe, expect, it } from "vitest";

import { codingWorkerModel } from "../agent/agent";
import { linearInputActivity } from "../agent/channels/linear";
import linearConnection from "../agent/connections/linear";
import { parseAgentSessionId } from "../agent/hooks/child-relay";
import { sessionUpdateActivity } from "../agent/tools/session_update";

describe("Linear agent interaction", () => {
  it("routes only delegated sessions to the coding worker model", () => {
    expect(codingWorkerModel({ data: {} })).toBeNull();
    expect(
      codingWorkerModel({ data: { invocation: { kind: "subagent" } } }),
    ).toEqual({
      model: "deepseek/deepseek-v4-flash",
      modelContextWindowTokens: 1_000_000,
    });
  });

  it("captures the agent session id the child relay hook needs", () => {
    expect(
      parseAgentSessionId(
        "<linear_context>\nagent_session_id: abc-123-def\n</linear_context>",
      ),
    ).toBe("abc-123-def");
    expect(parseAgentSessionId("agent_session_id: `sess-9`")).toBe("sess-9");
    expect(parseAgentSessionId("no session id here")).toBeNull();
  });

  it("uses one native selection for batched input requests", () => {
    const requests = ["linear__get_issue", "linear__list_comments"].map(
      (toolName) => ({
        action: {
          callId: toolName,
          input: {},
          kind: "tool-call" as const,
          toolName,
        },
        allowFreeform: false,
        display: "confirmation" as const,
        options: [
          { id: "approve", label: "Yes" },
          { id: "deny", label: "No" },
        ],
        prompt: `Approve tool call: ${toolName}`,
        requestId: toolName,
      }),
    );

    expect(linearInputActivity(requests)).toMatchObject({
      body: expect.stringContaining("- Get issue\n- List comments"),
      signal: "select",
      signalMetadata: {
        options: [
          { label: "Yes", value: "approve" },
          { label: "No", value: "deny" },
        ],
      },
    });
  });

  it("keeps progress out of issue comments", () => {
    expect(linearConnection.tools).toEqual({ block: ["save_comment"] });
  });

  it("preserves rich Markdown in Agent Session updates", () => {
    expect(
      sessionUpdateActivity({
        message:
          "## Changes\n\n- Added village state\n\n## Evidence\n\n`pnpm check` passes.",
        status: "progress",
      }),
    ).toEqual({
      body: "**Progress**\n\n## Changes\n\n- Added village state\n\n## Evidence\n\n`pnpm check` passes.",
      type: "response",
    });
  });
});
