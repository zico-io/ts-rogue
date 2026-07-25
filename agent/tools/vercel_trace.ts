import { defineTool } from "eve/tools";
import { z } from "zod";

import {
  requireProjectId,
  requireVercelCredentials,
  vercelJson,
} from "../lib/vercel-api";

/** `GET /v1/projects/traces` response shape ("Get a project trace by request ID"). */
export interface VercelTraceResponse {
  readonly trace: {
    readonly traceId: string;
    readonly rootSpanId?: string;
    readonly resources?: ReadonlyArray<{
      readonly name: string;
      readonly attributes: Record<string, unknown>;
    }>;
    readonly spans: ReadonlyArray<Record<string, unknown>>;
  };
}

export default defineTool({
  description:
    "Fetch the OTEL trace for a single Vercel CLI request by its request id (e.g. the `x-vercel-id` value from a response header, or a request id surfaced in a runtime log entry). Returns the full span tree for that one request - use this to see exactly what a specific slow or failing request did, after `vercel_logs` has narrowed down which request id to look at.",
  inputSchema: z.object({
    requestId: z.string().min(1).max(256),
    projectId: z
      .string()
      .min(1)
      .optional()
      .describe("Defaults to VERCEL_PROJECT_ID when omitted."),
  }),
  async execute(input) {
    const credentials = requireVercelCredentials();
    const projectId = requireProjectId(input.projectId);
    return vercelJson<VercelTraceResponse>("/v1/projects/traces", {
      credentials,
      query: { projectId, requestId: input.requestId },
    });
  },
});
