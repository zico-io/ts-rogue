import { defineTool } from "eve/tools";
import { z } from "zod";

import {
  requireProjectId,
  requireVercelCredentials,
  toNdjsonToolResult,
  vercelNdjson,
} from "../lib/vercel-api";

/** One row of `GET /v1/projects/{projectId}/deployments/{deploymentId}/runtime-logs`. */
export interface VercelRuntimeLogEntry {
  readonly domain: string;
  readonly level: "debug" | "error" | "fatal" | "info" | "trace" | "warning";
  readonly message: string;
  readonly messageTruncated: boolean;
  readonly requestMethod: string;
  readonly requestPath: string;
  readonly responseStatusCode: number;
  readonly rowId: string;
  readonly source:
    | "delimiter"
    | "edge-function"
    | "edge-middleware"
    | "request"
    | "serverless";
  readonly timestampInMs: number;
}

export default defineTool({
  description:
    "Fetch runtime logs for a Vercel deployment (the ts-rogue-eve agent's own production deployment). Returns an NDJSON stream of log lines - request/response, edge, and serverless entries - each with a level, message, source, and timestamp. Use to debug a specific deployment's production behavior. The read is bounded by `maxLines` and `timeoutMs` because this Vercel endpoint streams indefinitely rather than returning a fixed page; a `truncated: true` result means more logs exist past what was returned, not that the deployment is idle.",
  inputSchema: z.object({
    deploymentId: z
      .string()
      .min(1)
      .describe("Deployment id to fetch logs for."),
    projectId: z
      .string()
      .min(1)
      .optional()
      .describe("Defaults to VERCEL_PROJECT_ID when omitted."),
    since: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe(
        "Only return logs at or after this Unix timestamp in milliseconds.",
      ),
    until: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe(
        "Only return logs at or before this Unix timestamp in milliseconds.",
      ),
    limit: z
      .number()
      .int()
      .positive()
      .max(1000)
      .optional()
      .describe("Upstream page-size hint passed to Vercel, if supported."),
    maxLines: z
      .number()
      .int()
      .positive()
      .max(500)
      .default(200)
      .describe("Hard cap on how many log lines this call will read."),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .max(30_000)
      .default(10_000)
      .describe("Hard cap on how long this call will wait on the stream."),
  }),
  async execute(input) {
    const credentials = requireVercelCredentials();
    const projectId = requireProjectId(input.projectId);
    const result = await vercelNdjson<VercelRuntimeLogEntry>(
      `/v1/projects/${encodeURIComponent(projectId)}/deployments/${encodeURIComponent(input.deploymentId)}/runtime-logs`,
      {
        credentials,
        query: { since: input.since, until: input.until, limit: input.limit },
        maxLines: input.maxLines,
        timeoutMs: input.timeoutMs,
      },
    );
    return toNdjsonToolResult(result);
  },
});
