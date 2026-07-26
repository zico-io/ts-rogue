/**
 * Shared shapes for the /api/harness/* data-access routes (HAR-50).
 *
 * These routes read the Vercel Workflow run tags eve writes on every
 * session, turn, and subagent run (`$eve.type`, `$eve.parent`, `$eve.root`,
 * `$eve.subagent`, `$eve.trigger`, `$eve.title`, `$eve.model`, and the
 * per-turn token/tool-count tags) - see
 * `node_modules/eve/docs/guides/instrumentation.md#workflow-run-tags`.
 *
 * `$eve.*` names a run's parent and root but not its own id, and grouped
 * observability queries collapse rows that share every grouped dimension.
 * That rules out reconstructing an arbitrary-depth run tree from this tag
 * set alone, so `HarnessRunRecord` models one row per distinct
 * (root, subagent) combination - the root session's own turns aggregated,
 * plus one aggregate per subagent role it ran (orchestrator, coder,
 * reviewer, playtester, scout, ...) - rather than one row per literal run.
 */

export type HarnessRunType = "session" | "turn" | "subagent";

export type HarnessRunStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "unknown";

/** One eve-tagged Vercel Workflow run, normalized out of a raw observability row. */
export interface HarnessRunRecord {
  /** `$eve.root`: the session id of the root of this run's chain. */
  rootId: string;
  /** `$eve.parent`: the immediate parent's session id, or null at the root. */
  parentId: string | null;
  /** `$eve.type`. */
  type: HarnessRunType;
  /** `$eve.subagent`: the compiled graph node id, subagent runs only. */
  subagent: string | null;
  /** `$eve.trigger`: the channel kind that started the run. */
  trigger: string | null;
  /** `$eve.title`: truncated title derived from the first user message. */
  title: string | null;
  /** `$eve.model`. */
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  toolCount: number;
  status: HarnessRunStatus;
}

export interface HarnessSessionSummary {
  id: string;
  title: string | null;
  trigger: string | null;
  status: HarnessRunStatus;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

/** A node in a session's subagent tree: the root session or one subagent role. */
export interface HarnessRunNode {
  id: string;
  type: HarnessRunType;
  subagent: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  toolCount: number;
  status: HarnessRunStatus;
  children: HarnessRunNode[];
}

export type HarnessUnavailableReason =
  | "observability_plus_required"
  | "upstream_error";

export type HarnessResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: HarnessUnavailableReason };
