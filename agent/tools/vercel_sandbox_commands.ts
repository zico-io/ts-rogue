import { defineTool } from "eve/tools";
import { z } from "zod";

import {
  requireVercelCredentials,
  vercelJson,
  vercelNdjson,
} from "../lib/vercel-api";

/** "Command run in a Vercel Sandbox session (v2 API)". */
export interface VercelSandboxCommand {
  readonly id: string;
  readonly name: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly sessionId: string;
  readonly exitCode: number | null;
  readonly startedAt: number;
  readonly durationMs?: number;
}

export interface VercelListCommandsResponse {
  readonly commands: VercelSandboxCommand[];
}

export interface VercelGetCommandResponse {
  readonly command: VercelSandboxCommand;
}

/** One line of `GET .../cmd/{cmdId}/logs` (NDJSON: stdout/stderr chunks, or a stream-closed error entry). */
export type VercelCommandLogEntry =
  | { readonly stream: string; readonly data: string }
  | {
      readonly stream: string;
      readonly data: { readonly code: string; readonly message: string };
    };

export default defineTool({
  description:
    'List commands run inside a Vercel Sandbox session, inspect one command\'s status/exit code, or pull its stdout/stderr logs - the sandbox-triage counterpart to `vercel_sandboxes`. `action: "list"` returns every command run in a session, most recent first. `action: "get"` returns one command\'s exit code and timing (`wait: true` blocks until it finishes). `action: "logs"` streams that command\'s NDJSON stdout/stderr, bounded by `maxLines`/`timeoutMs` since this endpoint streams in real time rather than returning a fixed page.',
  inputSchema: z.discriminatedUnion("action", [
    z.object({
      action: z.literal("list"),
      sessionId: z.string().min(1),
    }),
    z.object({
      action: z.literal("get"),
      sessionId: z.string().min(1),
      cmdId: z.string().min(1),
      wait: z
        .boolean()
        .optional()
        .describe("Block until the command finishes."),
    }),
    z.object({
      action: z.literal("logs"),
      sessionId: z.string().min(1),
      cmdId: z.string().min(1),
      maxLines: z.number().int().positive().max(1000).default(500),
      timeoutMs: z.number().int().positive().max(30_000).default(10_000),
    }),
  ]),
  async execute(input) {
    const credentials = requireVercelCredentials();
    const sessionPath = `/v2/sandboxes/sessions/${encodeURIComponent(input.sessionId)}`;

    if (input.action === "list") {
      return vercelJson<VercelListCommandsResponse>(`${sessionPath}/cmd`, {
        credentials,
      });
    }

    if (input.action === "get") {
      return vercelJson<VercelGetCommandResponse>(
        `${sessionPath}/cmd/${encodeURIComponent(input.cmdId)}`,
        { credentials, query: { wait: input.wait } },
      );
    }

    const result = await vercelNdjson<VercelCommandLogEntry>(
      `${sessionPath}/cmd/${encodeURIComponent(input.cmdId)}/logs`,
      { credentials, maxLines: input.maxLines, timeoutMs: input.timeoutMs },
    );
    return {
      entries: result.lines,
      count: result.lines.length,
      truncated: result.truncated,
    };
  },
});
