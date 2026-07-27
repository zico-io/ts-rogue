/**
 * Resolves the team/project/token needed to call the Vercel REST API
 * server-side. Mirrors `agent/connections/vercel-api.ts`'s OIDC fallback;
 * duplicated (not imported) because `src/web` and `agent/` are separately
 * deployed halves of this app and do not cross-import (see
 * `src/web/README.md`'s cross-boundary import guardrails).
 */
export interface VercelApiEnv {
  token: string;
  teamId: string;
  projectId: string;
}

function decodeOidcIds(token: string | undefined): {
  teamId?: string;
  projectId?: string;
} {
  const payload = token?.split(".")[1];
  if (!payload) return {};
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      owner_id?: string;
      project_id?: string;
    };
    return { teamId: claims.owner_id, projectId: claims.project_id };
  } catch {
    return {};
  }
}

/** Returns null when the deployment lacks the credentials this needs. */
export function resolveVercelApiEnv(): VercelApiEnv | null {
  const token = process.env.VERCEL_TOKEN;
  if (!token) return null;

  const oidcIds = decodeOidcIds(process.env.VERCEL_OIDC_TOKEN);
  const teamId = process.env.VERCEL_TEAM_ID ?? oidcIds.teamId;
  const projectId = process.env.VERCEL_PROJECT_ID ?? oidcIds.projectId;
  if (!teamId || !projectId) return null;

  return { token, teamId, projectId };
}
