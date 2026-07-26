import { describe, expect, it } from "vitest";

import linearConnection from "../agent/connections/linear";
import { sessionUpdateActivity } from "../agent/tools/session_update";

describe("Linear agent interaction", () => {
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
