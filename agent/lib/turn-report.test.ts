import { describe, expect, it } from "vitest";

import type { ActionRequest, ActionResult } from "./session-event";
import {
  actionLabel,
  actionParameter,
  actionResultText,
  sessionFailureBody,
  turnFailureBody,
} from "./turn-report";

const subagentCall = {
  callId: "c1",
  description: "Delegate a focused subtask to a fresh copy of yourself.",
  input: { message: "" },
  kind: "subagent-call",
  name: "agent",
  nodeId: "n1",
  subagentName: "agent",
} satisfies ActionRequest;

const toolResult = {
  callId: "c1",
  kind: "tool-result",
  output: { stdout: "hello" },
  toolName: "bash",
} satisfies ActionResult;

describe("actionLabel", () => {
  it("humanizes a tool call and passes other action kinds through", () => {
    expect(
      actionLabel({
        callId: "c1",
        input: { command: "git status" },
        kind: "tool-call",
        toolName: "bash",
      }),
    ).toBe("Bash");
    expect(actionLabel(subagentCall)).toBe("subagent-call");
    expect(actionLabel({ callId: "c1", input: {}, kind: "load-skill" })).toBe(
      "load-skill",
    );
  });
});

describe("actionParameter", () => {
  it("labels a subagent-call with the delegation packet's lead line, not the static tool description", () => {
    expect(
      actionParameter({
        ...subagentCall,
        input: {
          message: "issue: ROG-65 - Add depth to the overworld\nscope: ...",
        },
      }),
    ).toBe("issue: ROG-65 - Add depth to the overworld");
  });

  it("falls back to the description when a subagent-call has no usable message", () => {
    expect(
      actionParameter({ ...subagentCall, input: { message: "   \n  " } }),
    ).toBe("Delegate a focused subtask to a fresh copy of yourself.");
  });

  it("renders a plain tool call as a readable parameter, not a JSON blob", () => {
    expect(
      actionParameter({
        callId: "c1",
        input: { command: "git status" },
        kind: "tool-call",
        toolName: "bash",
      }),
    ).toBe("git status");
  });

  it("serializes the input of a load-skill, the one kind carrying nothing else", () => {
    expect(
      actionParameter({ callId: "c1", input: { a: 1 }, kind: "load-skill" }),
    ).toBe('{"a":1}');
  });
});

describe("actionResultText", () => {
  it("summarizes a tool result rather than dumping raw JSON", () => {
    expect(actionResultText({ result: toolResult })).toBe("✓ done · 1 line");
  });

  it("prefers the error message when the action failed", () => {
    expect(
      actionResultText({
        error: { code: "tool_execution_failed", message: "Command not found" },
        result: { ...toolResult, isError: true, output: {} },
      }),
    ).toBe("Command not found");
  });

  it("serializes a subagent result's output", () => {
    expect(
      actionResultText({
        result: {
          callId: "c1",
          kind: "subagent-result",
          output: { summary: "Implemented all changes" },
          subagentName: "agent",
        },
      }),
    ).toBe(JSON.stringify({ summary: "Implemented all changes" }));
  });
});

describe("failure bodies", () => {
  const firstLineOf = (data: {
    readonly details?: unknown;
    readonly message: string;
  }) => turnFailureBody(data).split("\n")[0];

  it("names the error with whichever of name and message is present", () => {
    expect(
      firstLineOf({ details: { name: "TypeError" }, message: "boom" }),
    ).toContain("(TypeError: boom)");
    expect(
      firstLineOf({ details: { name: "TypeError" }, message: "  " }),
    ).toContain("(TypeError)");
    expect(firstLineOf({ message: "boom" })).toContain("(boom)");
    expect(firstLineOf({ message: "   " })).not.toContain("(");
  });

  it("shortens a long error message rather than dumping it inline", () => {
    const lead = firstLineOf({ message: "x".repeat(500) });

    expect(lead).toContain("…");
    expect(lead.length).toBeLessThan(250);
  });

  it("reports an error id only when it is a non-empty string", () => {
    expect(
      turnFailureBody({ details: { errorId: "err-1" }, message: "b" }),
    ).toContain("Error id: err-1");
    expect(
      turnFailureBody({ details: { errorId: "" }, message: "b" }),
    ).not.toContain("Error id");
    expect(
      turnFailureBody({ details: { errorId: 42 }, message: "b" }),
    ).not.toContain("Error id");
    expect(turnFailureBody({ details: null, message: "b" })).not.toContain(
      "Error id",
    );
  });

  it("tells the human to start a fresh session on an unrecoverable failure, in the channel's own words", () => {
    const body = sessionFailureBody(
      {
        details: { errorId: "err-1", name: "TypeError" },
        message: "boom",
      },
      "Start a new Linear agent session to continue.",
    );

    expect(body).toContain("could not recover");
    expect(body).toContain("(TypeError: boom)");
    expect(body).toContain("Start a new Linear agent session");
    expect(body).toContain("Error id: err-1");
  });

  it("invites a retry on a recoverable turn failure and omits an absent error id", () => {
    const body = turnFailureBody({ details: {}, message: "boom" });

    expect(body).toContain("Please try again");
    expect(body).not.toContain("Error id");
  });
});
