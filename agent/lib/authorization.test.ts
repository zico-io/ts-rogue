import { describe, expect, it } from "vitest";

import {
  authorizationDisplayName,
  authorizationOutcomeLabel,
} from "./authorization";

describe("authorizationDisplayName from the connection name", () => {
  it("title-cases a slug-style connection name", () => {
    expect(authorizationDisplayName({ name: "vercel" })).toBe("Vercel");
    expect(authorizationDisplayName({ name: "linear/ts-rogue-eve" })).toBe(
      "Linear Ts Rogue Eve",
    );
    expect(authorizationDisplayName({ name: "github_app" })).toBe("Github App");
  });
});

describe("authorizationDisplayName", () => {
  it("prefers the challenge's own display name", () => {
    expect(
      authorizationDisplayName({
        authorization: { displayName: "Linear MCP" },
        name: "linear",
      }),
    ).toBe("Linear MCP");
  });

  it("falls back to the title-cased connection name", () => {
    expect(authorizationDisplayName({ name: "vercel" })).toBe("Vercel");
    expect(
      authorizationDisplayName({ authorization: null, name: "vercel" }),
    ).toBe("Vercel");
  });
});

describe("authorizationOutcomeLabel", () => {
  it("reads timed-out as prose and passes other outcomes through", () => {
    expect(authorizationOutcomeLabel("timed-out")).toBe("timed out");
    expect(authorizationOutcomeLabel("denied")).toBe("denied");
  });
});
