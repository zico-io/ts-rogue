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
    // HAR-33: user-scoped interactive OAuth bound the grant to the inbound
    // principal, so ralph merge-wake turns (GitHub sender, never authorized)
    // parked forever on a consent flow no one could see. App-scoped auth is
    // getToken-only - eve never runs a consent flow for it.
    const auth = linearConnection.auth as Record<string, unknown>;
    expect(typeof auth.getToken).toBe("function");
    expect(auth.startAuthorization).toBeUndefined();
    expect(auth.completeAuthorization).toBeUndefined();
  });

  it("keeps progress out of issue comments", () => {
    // The allow-list is the guard now: session posts must flow through the
    // authored session_update/handoff tools, so `save_comment` (a session
    // post) stays out. The writable surface is exactly the project-content
    // writes: save_issue + save_project (HAR-47) plus the project-workflow
    // writes the two Linear skills need (HAR-64). A project status update is
    // project-content, not a session activity, so save_status_update belongs
    // here too.
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
    // A child's "completed"/"review" read as the whole session finishing
    // (ENG-2, HAR-11), so they are refused in code; blocked is the only
    // status a child may post, prefixed with its delegated issue.
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
    // The root passes through untouched.
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
