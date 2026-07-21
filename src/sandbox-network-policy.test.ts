import { describe, expect, it } from "vitest";

import { brokerRequest } from "../agent/proxy";
import { githubNetworkPolicy } from "../agent/sandbox";

describe("githubNetworkPolicy", () => {
  it("forwards all GitHub egress to the proxy so the credential is brokered per request", () => {
    const policy = githubNetworkPolicy("https://example.com/api/proxy");
    expect(policy).toEqual({
      allow: {
        "github.com": [{ forwardURL: "https://example.com/api/proxy" }],
        "*.github.com": [{ forwardURL: "https://example.com/api/proxy" }],
        "*": [],
      },
    });
  });

  it("falls back to open egress (no brokering) when no proxy URL is configured", () => {
    expect(githubNetworkPolicy(undefined)).toEqual({ allow: { "*": [] } });
  });
});

describe("brokerRequest", () => {
  it("injects a fresh GitHub token as Basic auth for github hosts, preserving method and path", async () => {
    let sent: Request | undefined;
    const res = await brokerRequest(
      new Request("https://github.com/zico-io/ts-rogue.git/git-receive-pack", {
        method: "POST",
        headers: { "content-type": "application/x-git-receive-pack-request" },
      }),
      "github.com",
      {
        mintGitHub: () => Promise.resolve("ghs_fresh_token"),
        send: (req) => {
          sent = req;
          return Promise.resolve(new Response("ok"));
        },
      },
    );

    expect(await res.text()).toBe("ok");
    expect(sent?.method).toBe("POST");
    expect(sent?.url).toBe(
      "https://github.com/zico-io/ts-rogue.git/git-receive-pack",
    );
    const expected = `Basic ${Buffer.from("x-access-token:ghs_fresh_token").toString("base64")}`;
    expect(sent?.headers.get("authorization")).toBe(expected);
    // Other headers survive the pass-through.
    expect(sent?.headers.get("content-type")).toBe(
      "application/x-git-receive-pack-request",
    );
  });

  it("forwards unbrokered hosts unchanged (no credential injected)", async () => {
    let sent: Request | undefined;
    await brokerRequest(
      new Request("https://registry.npmjs.org/some-pkg"),
      "registry.npmjs.org",
      {
        mintGitHub: () => Promise.reject(new Error("should not mint")),
        send: (req) => {
          sent = req;
          return Promise.resolve(new Response("ok"));
        },
      },
    );

    expect(sent?.headers.get("authorization")).toBeNull();
  });
});
