import { describe, expect, it } from "vitest";

import { linearInputActivity } from "../agent/channels/linear.js";
import { approveLinearTool } from "../agent/connections/linear.js";

describe("Linear agent interaction", () => {
  it("uses one native selection for batched read approvals", () => {
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
      body: expect.stringContaining(
        "- linear__get_issue\n- linear__list_comments",
      ),
      signal: "select",
      signalMetadata: {
        options: [
          { label: "Yes", value: "approve" },
          { label: "No", value: "deny" },
        ],
      },
    });
    expect(
      approveLinearTool({
        approvedTools: new Set(),
        toolName: "linear__get_issue",
      }),
    ).toBe("not-applicable");
    expect(
      approveLinearTool({
        approvedTools: new Set(),
        toolName: "linear__update_issue",
      }),
    ).toBe("user-approval");
  });
});
