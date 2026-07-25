import { defineOpenAPIConnection } from "eve/connections";
import type { Approval } from "eve/tools/approval";

// Every Vercel deployment carries VERCEL_OIDC_TOKEN, whose claims name the
// team (`owner_id`) and project (`project_id`) - so those ids need no env
// vars of their own. Decoded without verification (we only read static ids,
// and even an expired token still names them). The token itself is NOT used
// as the API bearer: tested 2026-07-25, api.vercel.com accepts OIDC on the
// sandbox endpoints but 403s it on observability and traces - and a warm
// Fluid instance serves a stale (~1h) OIDC env token anyway (ROG-65 class).
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

// Read-only guard ported from the deleted `vercel_sandboxes` tool: Vercel's
// docs say `resume: true` on GET /v2/sandboxes/{name} creates a new sandbox
// instance from the most recent snapshot when the sandbox is stopped - a
// mutation, out of scope for a triage surface. Generated OpenAPI tools expose
// every query param to the model, so the guard lives here as a deny policy.
// `toolName` arrives qualified (`vercel-api__getNamedSandbox`) and `toolInput`
// is the raw model input, so match loosely and read defensively.
export const vercelApiApproval: Approval = ({ toolName, toolInput }) => {
  if (toolName.endsWith("getNamedSandbox")) {
    const resume = toolInput?.resume;
    if (resume === true || resume === "true") return "denied";
  }
  return "not-applicable";
};

// Replaces the hand-rolled `vercel_trace`, `vercel_observability_query`,
// `vercel_sandboxes`, and `vercel_sandbox_commands` tools (and their
// `lib/vercel-api.ts` transport). Deliberately excluded from `allow`:
// `getRuntimeLogs` and `getSessionCommandLogs` are unbounded NDJSON streams a
// generated tool would hang on or dump whole (runtime logs are covered by the
// `vercel` MCP connection; command logs are an accepted loss - re-add as one
// small bounded-NDJSON authored tool if missed), plus every mutation
// (createSandboxes, runSessionCommand, stop/kill/fork/fs/snapshot/
// network-policy/extend-timeout).
export default defineOpenAPIConnection({
  spec: "https://openapi.vercel.sh",
  baseUrl: "https://api.vercel.com",
  // The hand-rolled transport injected teamId/projectId from env; generated
  // tools take them as model-supplied inputs, so the ids (not secrets) ride
  // along in the description instead.
  description:
    "Vercel REST API for the ts-rogue-eve project: OTEL request traces (getProjectTrace), the observability query engine (createObservabilityQuery - the same engine backing the Agent Runs and Workflow dashboards; eve tags every Vercel Workflow run with $eve.type session/turn/subagent, $eve.parent, $eve.root, $eve.subagent, $eve.trigger, $eve.title, and per-turn $eve.model/$eve.input_tokens/$eve.output_tokens/$eve.cache_read_tokens/$eve.tool_count - filter or group by these with OData syntax, e.g. \"$eve.root eq 'abc-123'\"; call getObservabilitySchema first to list metrics and their dimensions), and read-only Sandbox inspection (sandboxes, sessions, commands). " +
    `Always pass teamId=${teamId}; the default projectId is ${projectId}.`,
  auth: {
    getToken: async () => {
      const token = process.env.VERCEL_TOKEN;
      if (!token) {
        // Intentionally unset in local dev (.env.local carries only the OIDC
        // token); a clear throw beats a bare 401 from an empty Bearer.
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
