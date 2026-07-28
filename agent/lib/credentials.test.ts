import { describe, expect, it, vi } from "vitest";

vi.mock("@vercel/connect/eve", () => ({
  connectGitHubCredentials: () => ({}),
  connectLinearCredentials: () => ({}),
}));

const { resolveLinearAccessToken } = await import("./credentials");

describe("resolveLinearAccessToken", () => {
  it("resolves a literal token and a thunk", async () => {
    await expect(resolveLinearAccessToken("tok")).resolves.toBe("tok");
    await expect(resolveLinearAccessToken(() => "thunk-tok")).resolves.toBe(
      "thunk-tok",
    );
  });

  it("falls back through the env vars in order when earlier ones are unset", async () => {
    vi.stubEnv("LINEAR_AGENT_ACCESS_TOKEN", undefined);
    vi.stubEnv("LINEAR_ACCESS_TOKEN", "env-tok");
    try {
      await expect(resolveLinearAccessToken(undefined)).resolves.toBe(
        "env-tok",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("stops at an env var set to the empty string rather than falling through", async () => {
    vi.stubEnv("LINEAR_AGENT_ACCESS_TOKEN", "");
    vi.stubEnv("LINEAR_ACCESS_TOKEN", "env-tok");
    try {
      await expect(resolveLinearAccessToken(undefined)).rejects.toThrow(
        "missing Linear access token",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("throws a directive error when nothing resolves", async () => {
    vi.stubEnv("LINEAR_AGENT_ACCESS_TOKEN", "");
    vi.stubEnv("LINEAR_ACCESS_TOKEN", "");
    vi.stubEnv("LINEAR_API_KEY", "");
    vi.stubEnv("LINEAR_API_TOKEN", "");
    try {
      await expect(resolveLinearAccessToken(undefined)).rejects.toThrow(
        "missing Linear access token",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
