import { describe, expect, it } from "vitest";
import { newGame } from "../../engine/state/store";
import { runDevCommand } from "./DevConsole";

describe("runDevCommand", () => {
  const state = newGame(1);

  it("issues game events and rejects invalid commands", () => {
    expect(runDevCommand("scene overworld", state).event).toEqual({
      type: "ChangeScene",
      scene: "overworld",
    });
    expect(runDevCommand("log hello world", state).event).toEqual({
      type: "Log",
      message: "hello world",
    });
    expect(runDevCommand("scene nowhere", state).event).toBeUndefined();
    expect(runDevCommand("nope", state).output).toEqual([
      "Unknown command: nope. Run help.",
    ]);
  });

  it("signals a Linear issue with the right label, and needs a title", () => {
    expect(
      runDevCommand("bug battle crash on flee", state).createIssue,
    ).toEqual({ title: "battle crash on flee", label: "bug" });
    expect(runDevCommand("issue add a rest button", state).createIssue).toEqual(
      {
        title: "add a rest button",
        label: "feature",
      },
    );
    expect(runDevCommand("bug", state).createIssue).toBeUndefined();
    expect(runDevCommand("bug", state).output).toEqual(["Usage: bug <title>"]);
  });

  it("recruits a party member via a game event, and needs a classId", () => {
    expect(runDevCommand("recruit warrior", state).event).toEqual({
      type: "RecruitMember",
      classId: "warrior",
    });
    expect(runDevCommand("recruit", state).output).toEqual([
      "Usage: recruit <classId>",
    ]);
  });

  it("signals a flush of the local issue outbox", () => {
    expect(runDevCommand("flush", state).flushIssues).toBe(true);
  });

  it("prints the debug journal and signals a deliberate crash", () => {
    const journal = [{ at: "T0", kind: "dispatch" as const, event: "Log" }];
    expect(runDevCommand("debug", state, journal).output.join("\n")).toContain(
      '"event": "Log"',
    );
    expect(runDevCommand("crash synthetic failure", state).crash).toBe(
      "synthetic failure",
    );
    expect(runDevCommand("crash", state).output).toEqual([
      "Usage: crash <message>",
    ]);
  });
});
