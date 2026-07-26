import { describe, expect, it } from "vitest";

import linearConnection from "../agent/connections/linear";
import { parseAgentSessionId } from "../agent/hooks/relay";
import {
  forSessionRole,
  sessionUpdateActivity,
} from "../agent/tools/session_update";

describe("Linear agent interaction", () => {
  it("captures the agent session id the child relay hook needs", () => {
    expect(
      parseAgentSessionId(
        "<linear_context>\nagent_session_id: abc-123-def\n</linear_context>",
      ),
    ).toBe("abc-123-def");
    expect(parseAgentSessionId("agent_session_id: `sess-9`")).toBe("sess-9");
    expect(parseAgentSessionId("no session id here")).toBeNull();
  });

  it("resolves Linear MCP auth as the agent itself, with no interactive consent flow", () => {
    const auth = linearConnection.auth as Record<string, unknown>;
    expect(typeof auth.getToken).toBe("function");
    expect(auth.startAuthorization).toBeUndefined();
    expect(auth.completeAuthorization).toBeUndefined();
  });

  it("keeps progress out of issue comments", () => {
    const tools = linearConnection.tools as { allow: string[] };
    expect(tools.allow).not.toContain("save_comment");
    expect(tools.allow).toContain("save_issue");
    expect(tools.allow).toContain("save_project");
    const writes = tools.allow.filter(
      (name) => !/^(get_|list_|search_)/.test(name),
    );
    expect(writes).toEqual([
      "save_issue",
      "save_project",
      "save_milestone",
      "save_document",
      "save_status_update",
      "create_issue_label",
    ]);
  });

  it("keeps session-level statuses for the session owner only", () => {
    expect(
      forSessionRole({ message: "stuck", status: "blocked" }, true, "ENG-2"),
    ).toEqual({ message: "[ENG-2] stuck", status: "blocked" });
    expect(
      forSessionRole({ message: "stuck", status: "blocked" }, true, null),
    ).toEqual({ message: "stuck", status: "blocked" });
    expect(
      forSessionRole({ message: "done", status: "completed" }, true, "ENG-2"),
    ).toHaveProperty("refused");
    expect(
      forSessionRole({ message: "PR up", status: "review" }, true, "ENG-2"),
    ).toHaveProperty("refused");

    expect(
      forSessionRole({ message: "m", status: "completed" }, false, "ENG-2"),
    ).toEqual({ message: "m", status: "completed" });
  });

  it("preserves rich Markdown in Agent Session updates", () => {
    expect(
      sessionUpdateActivity({
        message:
          "## Changes\n\n- Added village state\n\n## Evidence\n\n`pnpm check` passes.",
        status: "review",
      }),
    ).toEqual({
      body: "**Review**\n\n## Changes\n\n- Added village state\n\n## Evidence\n\n`pnpm check` passes.",
      type: "response",
    });
  });
});
