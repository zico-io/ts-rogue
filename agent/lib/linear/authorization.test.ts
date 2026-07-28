import { describe, expect, it } from "vitest";

import { linearUserIdFromAuthContext } from "./authorization";

describe("linearUserIdFromAuthContext", () => {
  const linearUserAuth = {
    authenticator: "linear-agent-webhook",
    principalType: "user",
    subject: "user-1",
  };

  it("attributes the prompt to the Linear user who triggered the session", () => {
    expect(linearUserIdFromAuthContext(linearUserAuth)).toBe("user-1");
  });

  it("returns undefined for any non-Linear-user principal", () => {
    expect(linearUserIdFromAuthContext(null)).toBeUndefined();
    expect(
      linearUserIdFromAuthContext({
        ...linearUserAuth,
        authenticator: "github-webhook",
      }),
    ).toBeUndefined();
    expect(
      linearUserIdFromAuthContext({
        ...linearUserAuth,
        principalType: "service",
      }),
    ).toBeUndefined();
    expect(
      linearUserIdFromAuthContext({ ...linearUserAuth, subject: "unknown" }),
    ).toBeUndefined();
    expect(
      linearUserIdFromAuthContext({ ...linearUserAuth, subject: "" }),
    ).toBeUndefined();
  });
});
