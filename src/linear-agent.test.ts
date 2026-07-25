import { describe, expect, it } from "vitest";

import { codingWorkerModel } from "../agent/agent";
import linearConnection from "../agent/connections/linear";
import { parseAgentSessionId } from "../agent/hooks/child-relay";
import {
  forSessionRole,
  sessionUpdateActivity,
  workingActivity,
} from "../agent/tools/session_update";

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
    // authored session_update/handoff tools, so no comment/write tool beyond
    // save_issue may be discoverable.
    const tools = linearConnection.tools as { allow: string[] };
    expect(tools.allow).not.toContain("save_comment");
    expect(tools.allow).toContain("save_issue");
    const writes = tools.allow.filter(
      (name) => !/^(get_|list_|search_)/.test(name),
    );
    expect(writes).toEqual(["save_issue"]);
  });

  it("keeps session-level statuses for the session owner only", () => {
    // A child's "completed"/"started" read as the whole session finishing or
    // restarting (ENG-2, HAR-11), so child updates are downgraded to progress
    // and prefixed with their delegated issue; blocked keeps its urgency.
    expect(
      forSessionRole({ message: "done", status: "completed" }, true, "ENG-2"),
    ).toEqual({ message: "[ENG-2] done", status: "progress" });
    expect(
      forSessionRole({ message: "kickoff", status: "started" }, true, null),
    ).toEqual({ message: "kickoff", status: "progress" });
    expect(
      forSessionRole({ message: "stuck", status: "blocked" }, true, "ENG-2"),
    ).toEqual({ message: "[ENG-2] stuck", status: "blocked" });
    // The root passes through untouched.
    expect(
      forSessionRole({ message: "m", status: "completed" }, false, "ENG-2"),
    ).toEqual({ message: "m", status: "completed" });
  });

  it("chases still-working updates with an ephemeral Working chip, never terminal ones", () => {
    // Linear derives session state from the last emitted activity and a
    // `response` means "work completed" - without the chip, a mid-work
    // Progress update showed the session as Finished while the delegated
    // coding child was still running.
    expect(
      workingActivity({
        message: "Delegating the edit now.\n\nDetails follow.",
        status: "progress",
      }),
    ).toEqual({
      type: "action",
      action: "Working",
      parameter: "Delegating the edit now.",
    });
    expect(workingActivity({ message: "kickoff", status: "started" })).toEqual({
      type: "action",
      action: "Working",
      parameter: "kickoff",
    });
    // Terminal or human-handoff statuses must leave the durable response as
    // the last activity so the session state reflects reality.
    expect(workingActivity({ message: "m", status: "completed" })).toBeNull();
    expect(workingActivity({ message: "m", status: "review" })).toBeNull();
    expect(workingActivity({ message: "m", status: "blocked" })).toBeNull();
  });

  it("truncates the Working chip parameter to a chip-sized line", () => {
    const long = "x".repeat(500);
    const chip = workingActivity({ message: long, status: "progress" });
    expect(chip?.parameter).toHaveLength(120);
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
