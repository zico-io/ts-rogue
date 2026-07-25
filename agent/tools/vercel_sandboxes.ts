import { defineTool } from "eve/tools";
import { z } from "zod";

import { requireVercelCredentials, vercelJson } from "../lib/vercel-api";

/** Shared fields on both list and single-sandbox responses ("NamedSandbox"). */
export interface VercelSandboxSummary {
  readonly name: string;
  readonly status: "running" | "stopped" | "stopping";
  readonly statusUpdatedAt: number;
  readonly currentSessionId?: string;
  readonly currentSnapshotId?: string;
  readonly persistent: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly expiresAt?: number;
  readonly tags?: Record<string, string>;
}

export interface VercelListSandboxesResponse {
  readonly sandboxes: VercelSandboxSummary[];
  readonly pagination: { readonly count: number; readonly next: string | null };
}

/** Vercel Sandbox Session ("v2 endpoints return `session` instead of `sandbox`"). */
export interface VercelSandboxSession {
  readonly id: string;
  readonly projectId: string;
  readonly sourceSandboxName: string;
  readonly status:
    | "aborted"
    | "failed"
    | "pending"
    | "running"
    | "snapshotting"
    | "stopped"
    | "stopping";
  readonly region: string;
  readonly runtime: string;
  readonly cwd: string;
  readonly requestedAt: number;
  readonly startedAt?: number;
  readonly stoppedAt?: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface VercelGetSandboxResponse {
  readonly sandbox: VercelSandboxSummary;
  readonly session: VercelSandboxSession;
  readonly routes: ReadonlyArray<{
    readonly url: string;
    readonly port: number;
    readonly subdomain: string;
  }>;
  readonly resumed: boolean;
}

export interface VercelListSessionsResponse {
  readonly sessions: VercelSandboxSession[];
  readonly pagination: { readonly count: number; readonly next: string | null };
}

export interface VercelGetSessionResponse {
  readonly session: VercelSandboxSession;
  readonly routes: ReadonlyArray<{
    readonly url: string;
    readonly port: number;
    readonly subdomain: string;
  }>;
}

// Anthropic requires a top-level `type: "object"` input schema, so the
// union can't be the inputSchema itself - it stays as the strict runtime
// parser while a flat object schema is what the model sees.
const inputVariants = z.union([
  z.object({
    resource: z.literal("sandbox"),
    action: z.literal("list"),
    project: z.string().min(1).optional(),
    status: z.enum(["running", "stopping", "stopped"]).optional(),
    namePrefix: z.string().min(1).optional(),
    tags: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    cursor: z.string().min(1).optional(),
    sortBy: z
      .enum(["createdAt", "name", "statusUpdatedAt", "currentSnapshotId"])
      .optional(),
    sortOrder: z.enum(["asc", "desc"]).optional(),
  }),
  z.object({
    resource: z.literal("sandbox"),
    action: z.literal("get"),
    name: z.string().min(1),
    projectId: z.string().min(1).optional(),
  }),
  z.object({
    resource: z.literal("session"),
    action: z.literal("list"),
    project: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    cursor: z.string().min(1).optional(),
    sortOrder: z.enum(["asc", "desc"]).optional(),
  }),
  z.object({
    resource: z.literal("session"),
    action: z.literal("get"),
    sessionId: z.string().min(1),
  }),
]);

export default defineTool({
  description:
    'List or inspect Vercel Sandboxes and their sessions, to triage a stuck or failed sandbox. `resource: "sandbox", action: "list"` finds sandboxes by project/status/name-prefix/tag; `resource: "sandbox", action: "get"` looks up one by name, including its current session and routes. `resource: "session", action: "list"` / `"get"` inspect a session directly by id, including its status (pending/running/failed/aborted/stopped/stopping) and resource config. Read-only: this never stops, resumes, or mutates anything.',
  inputSchema: z.object({
    resource: z.enum(["sandbox", "session"]),
    action: z.enum(["list", "get"]),
    project: z
      .string()
      .min(1)
      .optional()
      .describe('`action: "list"` only: filter by project.'),
    status: z
      .enum(["running", "stopping", "stopped"])
      .optional()
      .describe('Sandbox `action: "list"` only.'),
    namePrefix: z
      .string()
      .min(1)
      .optional()
      .describe('Sandbox `action: "list"` only.'),
    tags: z
      .string()
      .min(1)
      .optional()
      .describe('Sandbox `action: "list"` only: single `key:value` tag filter.'),
    limit: z.number().int().min(1).max(50).optional(),
    cursor: z.string().min(1).optional(),
    sortBy: z
      .enum(["createdAt", "name", "statusUpdatedAt", "currentSnapshotId"])
      .optional()
      .describe('Sandbox `action: "list"` only.'),
    sortOrder: z.enum(["asc", "desc"]).optional(),
    name: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Sandbox name. Required for sandbox `action: "get"`; on session `action: "list"` it filters to one sandbox\'s sessions.',
      ),
    projectId: z
      .string()
      .min(1)
      .optional()
      .describe('Sandbox `action: "get"` only.'),
    sessionId: z
      .string()
      .min(1)
      .optional()
      .describe('Required for session `action: "get"`.'),
  }),
  async execute(rawInput) {
    const input = inputVariants.parse(rawInput);
    const credentials = requireVercelCredentials();

    if (input.resource === "sandbox" && input.action === "list") {
      return vercelJson<VercelListSandboxesResponse>("/v2/sandboxes", {
        credentials,
        query: {
          project: input.project,
          status: input.status,
          namePrefix: input.namePrefix,
          tags: input.tags,
          limit: input.limit,
          cursor: input.cursor,
          sortBy: input.sortBy,
          sortOrder: input.sortOrder,
        },
      });
    }

    if (input.resource === "sandbox" && input.action === "get") {
      return vercelJson<VercelGetSandboxResponse>(
        `/v2/sandboxes/${encodeURIComponent(input.name)}`,
        {
          // `resume` is deliberately never forwarded: Vercel's docs say
          // `resume: true` on this GET creates a new sandbox instance from
          // the most recent snapshot when the sandbox is stopped, which is
          // a mutation - out of scope for a read-only triage tool. Omitting
          // it defaults to `resume: false` server-side.
          credentials,
          query: { projectId: input.projectId },
        },
      );
    }

    if (input.resource === "session" && input.action === "list") {
      return vercelJson<VercelListSessionsResponse>("/v2/sandboxes/sessions", {
        credentials,
        query: {
          project: input.project,
          name: input.name,
          limit: input.limit,
          cursor: input.cursor,
          sortOrder: input.sortOrder,
        },
      });
    }

    return vercelJson<VercelGetSessionResponse>(
      `/v2/sandboxes/sessions/${encodeURIComponent(input.sessionId)}`,
      { credentials },
    );
  },
});
