import { defineOpenAPIConnection } from "eve/connections";
import type { Approval } from "eve/tools/approval";

export const decodeOidcIds = (
  token: string | undefined,
): { teamId?: string; projectId?: string } => {
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
};

const oidcIds = decodeOidcIds(process.env.VERCEL_OIDC_TOKEN);
const teamId = process.env.VERCEL_TEAM_ID ?? oidcIds.teamId ?? "<unset>";
const projectId =
  process.env.VERCEL_PROJECT_ID ?? oidcIds.projectId ?? "<unset>";

export const vercelApiApproval: Approval = ({ toolName, toolInput }) => {
  if (toolName.endsWith("getNamedSandbox")) {
    const resume = toolInput?.resume;
    if (resume === true || resume === "true") return "denied";
  }
  return "not-applicable";
};

export default defineOpenAPIConnection({
  spec: "https://openapi.vercel.sh",
  baseUrl: "https://api.vercel.com",

  description:
    "Vercel REST API for the ts-rogue-eve project: OTEL request traces (getProjectTrace), the observability query engine (createObservabilityQuery - the same engine backing the Agent Runs and Workflow dashboards; eve tags every Vercel Workflow run with $eve.type session/turn/subagent, $eve.parent, $eve.root, $eve.subagent, $eve.trigger, $eve.title, and per-turn $eve.model/$eve.input_tokens/$eve.output_tokens/$eve.cache_read_tokens/$eve.tool_count - filter or group by these with OData syntax, e.g. \"$eve.root eq 'abc-123'\"; call getObservabilitySchema first to list metrics and their dimensions), and read-only Sandbox inspection (sandboxes, sessions, commands). " +
    `Always pass teamId=${teamId}; the default projectId is ${projectId}.`,
  auth: {
    getToken: async () => {
      const token = process.env.VERCEL_TOKEN;
      if (!token) {
        throw new Error(
          "VERCEL_TOKEN is not set - the vercel-api connection needs it",
        );
      }
      return { token };
    },
  },
  operations: {
    allow: [
      "getProjectTrace",
      "createObservabilityQuery",
      "getObservabilitySchema",
      "getObservabilitySchemaByMetricId",
      "listSandboxes",
      "getNamedSandbox",
      "listSessions",
      "getSession",
      "listSessionCommands",
      "getSessionCommand",
    ],
  },
  approval: vercelApiApproval,
});
