import { describe, expect, it } from "vitest";

import {
  decodeOidcIds,
  vercelApiApproval,
} from "../agent/connections/vercel-api";

// The approval policy is the only remaining home of the read-only guard the
// deleted `vercel_sandboxes` tool enforced in code: `resume: true` on
// GET /v2/sandboxes/{name} mutates (new instance from snapshot).
describe("vercelApiApproval", () => {
  // Only toolName/toolInput matter to the policy; the SessionContext fields
  // it never reads are not faked.
  const call = (toolName: string, toolInput?: Record<string, unknown>) =>
    vercelApiApproval({
      toolName,
      toolInput,
      approvedTools: new Set<string>(),
      callId: "call-1",
    } as never);

  it("denies getNamedSandbox with resume: true", () => {
    expect(call("vercel-api__getNamedSandbox", { resume: true })).toBe(
      "denied",
    );
  });

  it('denies getNamedSandbox with resume: "true" (raw model input)', () => {
    expect(call("vercel-api__getNamedSandbox", { resume: "true" })).toBe(
      "denied",
    );
  });

  it("allows getNamedSandbox without resume", () => {
    expect(call("vercel-api__getNamedSandbox", { name: "eve" })).toBe(
      "not-applicable",
    );
    expect(call("vercel-api__getNamedSandbox", { resume: false })).toBe(
      "not-applicable",
    );
  });

  it("tolerates undefined input", () => {
    expect(call("vercel-api__getNamedSandbox")).toBe("not-applicable");
  });

  it("ignores other tools", () => {
    expect(call("vercel-api__listSandboxes", { resume: true })).toBe(
      "not-applicable",
    );
  });
});

describe("decodeOidcIds", () => {
  const jwt = (claims: Record<string, unknown>) =>
    `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.y`;

  it("reads team and project ids from the OIDC claims", () => {
    expect(
      decodeOidcIds(jwt({ owner_id: "team_1", project_id: "prj_1" })),
    ).toEqual({ teamId: "team_1", projectId: "prj_1" });
  });

  it("returns nothing for a missing or malformed token", () => {
    expect(decodeOidcIds(undefined)).toEqual({});
    expect(decodeOidcIds("not-a-jwt")).toEqual({});
    expect(decodeOidcIds("a.%%%.c")).toEqual({});
  });
});
