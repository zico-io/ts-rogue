import { describe, expect, it } from "vitest";

import { linearInputActivity } from "../agent/channels/linear.js";
import linearConnection from "../agent/connections/linear.js";
import { sessionUpdateActivity } from "../agent/tools/session_update.js";

describe("Linear agent interaction", () => {
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
      type: "thought",
    });
  });
});
