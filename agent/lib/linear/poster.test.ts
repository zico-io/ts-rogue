import type { LinearAgentActivityCreateInput } from "eve/channels/linear";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createActivity } = vi.hoisted(() => ({
  createActivity: vi.fn(
    async (_input: { readonly activity: LinearAgentActivityCreateInput }) => ({
      id: "a",
      success: true,
    }),
  ),
}));

vi.mock("@vercel/connect/eve", () => ({
  connectLinearCredentials: () => ({}),
}));
vi.mock("eve/channels/linear", () => ({
  createLinearAgentActivity: (input: {
    readonly activity: LinearAgentActivityCreateInput;
  }) => createActivity(input),
}));

const { postLinearUpdate } = await import("./poster");

const activity = (call = 0) => createActivity.mock.calls[call][0].activity;

/** The posted chip's result, which only an `action` activity carries. */
const activityResult = (call = 0): string | undefined => {
  const { content } = activity(call);
  return content.type === "action" ? content.result : undefined;
};

beforeEach(() => {
  createActivity.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("postLinearUpdate", () => {
  it("posts a chip against the agent session the token names", async () => {
    await postLinearUpdate("agent-session:sess-1", {
      action: "Bash",
      kind: "action",
      parameter: "git status",
      transient: true,
    });

    expect(activity().agentSessionId).toBe("sess-1");
    expect(activity().ephemeral).toBe(true);
    expect(activity().content).toEqual({
      action: "Bash",
      parameter: "git status",
      type: "action",
    });
  });

  it("applies Linear's activity cap, since this is the code that posts", async () => {
    await postLinearUpdate("agent-session:sess-1", {
      action: "Agent",
      kind: "action",
      parameter: "Workflow call 1",
      result: "x".repeat(400),
    });

    expect(activityResult()).toHaveLength(300);
    expect(activityResult()?.endsWith("…")).toBe(true);
  });

  it("posts prose as its own activity type", async () => {
    await postLinearUpdate("agent-session:sess-1", {
      body: "Working on this.",
      kind: "thought",
    });

    expect(activity().content).toEqual({
      body: "Working on this.",
      type: "thought",
    });
  });

  it("ignores a token that is not a Linear agent session", async () => {
    await postLinearUpdate("issue:42", {
      body: "hello",
      kind: "response",
    });

    expect(createActivity).not.toHaveBeenCalled();
  });

  it("ignores the updates that need the channel's own session handle", async () => {
    await postLinearUpdate("agent-session:sess-1", {
      kind: "plan",
      steps: [],
    });
    await postLinearUpdate("agent-session:sess-1", {
      kind: "inputPrompt",
      requests: [],
    });

    expect(createActivity).not.toHaveBeenCalled();
  });

  it("warns instead of throwing when Linear rejects the post", async () => {
    createActivity.mockRejectedValueOnce(new Error("linear down"));

    await expect(
      postLinearUpdate("agent-session:sess-1", {
        body: "hello",
        kind: "response",
      }),
    ).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("posting a Linear activity failed"),
      "linear down",
    );
  });
});
