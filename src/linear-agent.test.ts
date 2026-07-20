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
      body: expect.stringContaining("- Get issue\n- List comments"),
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

  it("describes Linear mutations without internal tool names", () => {
    const requests = ["linear__save_issue", "linear__save_comment"].map(
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

    expect(linearInputActivity(requests).body).toContain(
      "Approve these Linear changes?\n\n- Create or update an issue\n- Post or update a comment",
    );
  });
});
