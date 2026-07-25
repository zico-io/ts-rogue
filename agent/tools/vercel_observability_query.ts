import { defineTool } from "eve/tools";
import { z } from "zod";

import {
  requireVercelCredentials,
  VercelApiError,
  vercelJson,
} from "../lib/vercel-api";

/** `GET /v2/observability/schema` entry. */
export interface VercelObservabilityMetricSummary {
  readonly id: string;
  readonly description: string;
}

/** `GET /v2/observability/schema/{metricId}` entry. */
export interface VercelObservabilityMetricDetail {
  readonly id: string;
  readonly description: string;
  readonly unit: string;
  readonly aggregations: readonly string[];
  readonly defaultAggregation: string;
  readonly dimensions: ReadonlyArray<{
    readonly name: string;
    readonly label: string;
  }>;
}

const scopeSchema = z
  .record(z.string(), z.unknown())
  .describe(
    'Owner/project scope object for the query, e.g. { "projectId": "..." }. Defaults to { projectId: VERCEL_PROJECT_ID } when omitted and VERCEL_PROJECT_ID is set.',
  );

// Anthropic requires a top-level `type: "object"` input schema, so the
// discriminated union can't be the inputSchema itself - it stays as the
// strict runtime parser while a flat object schema is what the model sees.
const inputVariants = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("schema"),
    metricId: z.string().min(1).optional(),
  }),
  z.object({
    mode: z.literal("query"),
    metric: z.string().min(1),
    scope: scopeSchema.optional(),
    aggregation: z.string().optional(),
    groupBy: z.array(z.string()).optional(),
    filter: z.string().optional(),
    limit: z.number().int().positive().max(1000).optional(),
    orderBy: z.string().optional(),
    orderDirection: z.enum(["asc", "desc"]).optional(),
    granularity: z.record(z.string(), z.unknown()).optional(),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    bucketTimezone: z.string().optional(),
  }),
]);

export default defineTool({
  description:
    'Discover and query Vercel\'s observability query engine (`/v2/observability/query`), the same engine backing the Agent Runs and Workflow dashboards for the ts-rogue-eve agent. eve tags every Vercel Workflow run with `$eve.type` (session/turn/subagent), `$eve.parent`, `$eve.root`, `$eve.subagent`, `$eve.trigger`, `$eve.title`, and per-turn `$eve.model`/`$eve.input_tokens`/`$eve.output_tokens`/`$eve.cache_read_tokens`/`$eve.tool_count` - filter or group by these (OData syntax, e.g. `$eve.root eq \'abc-123\'`) to inspect a specific session/turn/subagent run or roll up token/tool usage. There is no fixed metric id for workflow-run data, so call with `mode: "schema"` first (optionally with `metricId`) to list available metrics and their dimensions/aggregations before calling with `mode: "query"`.',
  inputSchema: z.object({
    mode: z.enum(["schema", "query"]),
    metricId: z
      .string()
      .min(1)
      .optional()
      .describe(
        '`mode: "schema"` only. Omit to list all metric ids; pass one to see its dimensions and aggregations.',
      ),
    metric: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Metric id from `mode: "schema"`. Required for `mode: "query"`.',
      ),
    scope: scopeSchema.optional(),
    aggregation: z
      .string()
      .optional()
      .describe(
        "e.g. `count`, or `<agg>/<dimension>` such as `unique/visitor_id`.",
      ),
    groupBy: z.array(z.string()).optional(),
    filter: z
      .string()
      .optional()
      .describe(
        "OData filter expression, e.g. `$eve.root eq 'abc-123' and $eve.type eq 'turn'`.",
      ),
    limit: z.number().int().positive().max(1000).optional(),
    orderBy: z.string().optional(),
    orderDirection: z.enum(["asc", "desc"]).optional(),
    granularity: z.record(z.string(), z.unknown()).optional(),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    bucketTimezone: z.string().optional(),
  }),
  async execute(rawInput) {
    const input = inputVariants.parse(rawInput);
    const credentials = requireVercelCredentials();

    if (input.mode === "schema") {
      if (input.metricId) {
        return vercelJson<VercelObservabilityMetricDetail[]>(
          `/v2/observability/schema/${encodeURIComponent(input.metricId)}`,
          { credentials },
        );
      }
      return vercelJson<{ metrics: VercelObservabilityMetricSummary[] }>(
        "/v2/observability/schema",
        { credentials },
      );
    }

    const scope = input.scope ?? defaultScope(credentials.teamId);
    if (!scope) {
      throw new VercelApiError(
        'observability query requires `scope` (e.g. { projectId: "..." }) - pass one explicitly or set VERCEL_PROJECT_ID.',
      );
    }
    return vercelJson<unknown>("/v2/observability/query", {
      credentials,
      method: "POST",
      body: {
        metric: input.metric,
        scope,
        aggregation: input.aggregation,
        groupBy: input.groupBy,
        filter: input.filter,
        limit: input.limit,
        orderBy: input.orderBy,
        orderDirection: input.orderDirection,
        granularity: input.granularity,
        startTime: input.startTime,
        endTime: input.endTime,
        bucketTimezone: input.bucketTimezone,
      },
    });
  },
});

function defaultScope(
  teamId: string | undefined,
): Record<string, unknown> | undefined {
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (!projectId) return undefined;
  return teamId ? { projectId, teamId } : { projectId };
}
