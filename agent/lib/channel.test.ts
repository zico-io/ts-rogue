import { describe, expect, it } from "vitest";

import { textRenderer } from "./channel";
import type { SessionUpdate } from "./session";

interface Channel {
  readonly posts: string[];
}

const renderer = (maxLength: number) =>
  textRenderer<Channel>({
    maxLength,
    post: async (channel, body) => {
      channel.posts.push(body);
    },
    restartHint: "Start over.",
  });

const render = async (update: SessionUpdate, maxLength = 10) => {
  const channel: Channel = { posts: [] };
  await renderer(maxLength).render(update, channel);
  return channel.posts;
};

describe("textRenderer", () => {
  it("posts a body that fits as exactly one post", async () => {
    expect(await render({ body: "0123456789", kind: "response" })).toEqual([
      "0123456789",
    ]);
  });

  it("splits a body longer than the cap, with every post within it", async () => {
    const posts = await render({ body: "x".repeat(25), kind: "response" });

    expect(posts).toEqual(["x".repeat(10), "x".repeat(10), "x".repeat(5)]);
    expect(posts.join("")).toHaveLength(25);
  });

  it("renders an authorization prompt as a link, since there is no native surface", async () => {
    expect(
      await render(
        {
          body: "I need GitHub connected.",
          displayName: "GitHub",
          kind: "authPrompt",
          url: "https://example.test/auth",
        },
        200,
      ),
    ).toEqual([
      "I need GitHub connected.\n\n[Authorize GitHub](https://example.test/auth)",
    ]);
  });

  it("posts nothing for the kinds a text channel cannot show", async () => {
    expect(
      await render({
        action: "Bash",
        kind: "action",
        parameter: "git status",
      }),
    ).toEqual([]);
    expect(await render({ kind: "plan", steps: [] })).toEqual([]);
    expect(await render({ kind: "inputPrompt", requests: [] })).toEqual([]);
  });
});
