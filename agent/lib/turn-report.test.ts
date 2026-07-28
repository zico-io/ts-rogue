import { describe, expect, it } from "vitest";

import {
  actionLabel,
  actionParameter,
  actionResultText,
  sessionFailureBody,
  turnFailureBody,
} from "./turn-report";

describe("actionLabel", () => {
  it("humanizes a tool call and passes other action kinds through", () => {
    expect(actionLabel({ kind: "tool-call", toolName: "bash" })).toBe("Bash");
    expect(actionLabel({ kind: "subagent-call", name: "agent" })).toBe(
      "subagent-call",
    );
    expect(actionLabel({ kind: "load-skill" })).toBe("load-skill");
  });
});

describe("actionParameter", () => {
  it("labels a subagent-call with the delegation packet's lead line, not the static tool description", () => {
    expect(
      actionParameter({
        kind: "subagent-call",
        name: "agent",
        description: "Delegate a focused subtask to a fresh copy of yourself.",
        input: {
          message: "issue: ROG-65 - Add depth to the overworld\nscope: ...",
        },
      }),
    ).toBe("issue: ROG-65 - Add depth to the overworld");
  });

  it("falls back to the description when a subagent-call has no usable message", () => {
    expect(
      actionParameter({
        kind: "subagent-call",
        name: "agent",
        description: "Delegate a focused subtask to a fresh copy of yourself.",
        input: { message: "   \n  " },
      }),
    ).toBe("Delegate a focused subtask to a fresh copy of yourself.");
  });

  it("renders a plain tool call as a readable parameter, not a JSON blob", () => {
    expect(
      actionParameter({
        kind: "tool-call",
        callId: "c1",
        toolName: "bash",
        input: { command: "git status" },
      }),
    ).toBe("git status");
  });

  it("falls back to the name, then the serialized input, then empty", () => {
    expect(actionParameter({ kind: "load-skill", name: "eve" })).toBe("eve");
    expect(actionParameter({ kind: "load-skill", input: { a: 1 } })).toBe(
      '{"a":1}',
    );
    expect(actionParameter({ kind: "load-skill" })).toBe("");
  });
});

describe("actionResultText", () => {
  it("summarizes a tool result rather than dumping raw JSON", () => {
    expect(
      actionResultText({
        result: {
          kind: "tool-result",
          toolName: "bash",
          output: { stdout: "hello" },
        },
      }),
    ).toBe("✓ done · 1 line");
  });

  it("prefers the error message when the action failed", () => {
    expect(
      actionResultText({
        error: { message: "Command not found" },
        result: {
          kind: "tool-result",
          toolName: "bash",
          isError: true,
          output: {},
        },
      }),
    ).toBe("Command not found");
  });

  it("serializes a subagent result's output", () => {
    expect(
      actionResultText({
        result: {
          kind: "subagent-result",
          output: { summary: "Implemented all changes" },
        },
      }),
    ).toBe(JSON.stringify({ summary: "Implemented all changes" }));
  });

  it("returns an empty string for an unserializable or absent output", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(
      actionResultText({
        result: { kind: "subagent-result", output: circular },
      }),
    ).toBe("");
    expect(actionResultText({ result: { kind: "subagent-result" } })).toBe("");
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
