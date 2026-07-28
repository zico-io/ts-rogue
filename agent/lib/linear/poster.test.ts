import { beforeEach, describe, expect, it, vi } from "vitest";

const { createActivity } = vi.hoisted(() => ({
  // biome-ignore lint/suspicious/noExplicitAny: mock captures the Linear activity payload
  createActivity: vi.fn(async (_input: any) => ({ id: "a", success: true })),
}));

vi.mock("@vercel/connect/eve", () => ({
  connectLinearCredentials: () => ({}),
}));
vi.mock("eve/channels/linear", () => ({
  createLinearAgentActivity: (input: unknown) => createActivity(input),
}));

const { linearPoster } = await import("./poster");

const activity = (call = 0) => createActivity.mock.calls[call]?.[0].activity;

beforeEach(() => {
  createActivity.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("linearPoster", () => {
  it("posts a chip against the agent session the token names", async () => {
    await linearPoster.post("agent-session:sess-1", {
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
    await linearPoster.post("agent-session:sess-1", {
      action: "Agent",
      kind: "action",
      parameter: "Workflow call 1",
      result: "x".repeat(400),
    });

    expect(activity().content.result).toHaveLength(300);
    expect(activity().content.result.endsWith("…")).toBe(true);
  });

  it("posts prose as its own activity type", async () => {
    await linearPoster.post("agent-session:sess-1", {
      body: "Working on this.",
      kind: "thought",
    });

    expect(activity().content).toEqual({
      body: "Working on this.",
      type: "thought",
    });
  });

  it("ignores a token that is not a Linear agent session", async () => {
    await linearPoster.post("issue:42", {
      body: "hello",
      kind: "response",
    });

    expect(createActivity).not.toHaveBeenCalled();
  });

  it("ignores the updates that need the channel's own session handle", async () => {
    await linearPoster.post("agent-session:sess-1", {
      kind: "plan",
      steps: [],
    });
    await linearPoster.post("agent-session:sess-1", {
      kind: "inputPrompt",
      requests: [],
    });

    expect(createActivity).not.toHaveBeenCalled();
  });

  it("warns instead of throwing when Linear rejects the post", async () => {
    createActivity.mockRejectedValueOnce(new Error("linear down"));

    await expect(
      linearPoster.post("agent-session:sess-1", {
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
