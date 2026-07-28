import { beforeEach, describe, expect, it, vi } from "vitest";

import { postUpdate } from "./channel-registry";
import type { SessionUpdate } from "./session";

const post = vi.fn();

// Stubbed so the registry's lazy `import()` resolves without pulling Linear's
// Connect credentials into the test process - which is the point of it being lazy.
vi.mock("./linear/poster", () => ({ linearPoster: { post } }));

const update: SessionUpdate = {
  action: "Bash",
  kind: "action",
  parameter: "git status",
};

beforeEach(() => {
  post.mockClear();
});

describe("postUpdate", () => {
  it("hands the update to the poster for the channel that owns the session", async () => {
    await postUpdate(
      { continuationToken: "agent-session:abc", kind: "linear" },
      update,
    );

    expect(post).toHaveBeenCalledWith("agent-session:abc", update);
  });

  it("shows nothing on a channel with no poster", async () => {
    await postUpdate({ continuationToken: "issue:1", kind: "github" }, update);
    await postUpdate({ continuationToken: "agent-session:abc" }, update);

    expect(post).not.toHaveBeenCalled();
  });

  it("shows nothing without a continuation token to address", async () => {
    await postUpdate({ kind: "linear" }, update);
    await postUpdate({ continuationToken: "", kind: "linear" }, update);

    expect(post).not.toHaveBeenCalled();
  });
});
