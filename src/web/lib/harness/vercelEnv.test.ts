import { afterEach, describe, expect, it } from "vitest";
import { resolveVercelApiEnv } from "./vercelEnv";

const ENV_KEYS = [
  "VERCEL_TOKEN",
  "VERCEL_TEAM_ID",
  "VERCEL_PROJECT_ID",
  "VERCEL_OIDC_TOKEN",
] as const;

function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

describe("resolveVercelApiEnv", () => {
  afterEach(clearEnv);

  it("returns null when VERCEL_TOKEN is unset", () => {
    clearEnv();
    expect(resolveVercelApiEnv()).toBeNull();
  });

  it("returns null when the team/project id cannot be resolved from anywhere", () => {
    clearEnv();
    process.env.VERCEL_TOKEN = "token";
    expect(resolveVercelApiEnv()).toBeNull();
  });

  it("prefers explicit VERCEL_TEAM_ID/VERCEL_PROJECT_ID over OIDC claims", () => {
    clearEnv();
    process.env.VERCEL_TOKEN = "token";
    process.env.VERCEL_TEAM_ID = "team_explicit";
    process.env.VERCEL_PROJECT_ID = "prj_explicit";
    expect(resolveVercelApiEnv()).toEqual({
      token: "token",
      teamId: "team_explicit",
      projectId: "prj_explicit",
    });
  });

  it("falls back to decoding VERCEL_OIDC_TOKEN claims", () => {
    clearEnv();
    process.env.VERCEL_TOKEN = "token";
    const claims = { owner_id: "team_oidc", project_id: "prj_oidc" };
    process.env.VERCEL_OIDC_TOKEN = `x.${Buffer.from(
      JSON.stringify(claims),
    ).toString("base64url")}.y`;
    expect(resolveVercelApiEnv()).toEqual({
      token: "token",
      teamId: "team_oidc",
      projectId: "prj_oidc",
    });
  });

  it("tolerates a malformed OIDC token and returns null", () => {
    clearEnv();
    process.env.VERCEL_TOKEN = "token";
    process.env.VERCEL_OIDC_TOKEN = "not-a-jwt";
    expect(resolveVercelApiEnv()).toBeNull();
  });
});
