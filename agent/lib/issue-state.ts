import type { LinearChannelConfig } from "eve/channels/linear";
import { callLinearGraphQL } from "eve/channels/linear";

// Harness-owned Linear issue lifecycle: the model no longer decides workflow
// state, the harness reconciles it deterministically on lifecycle events
// (session created -> In Progress with parent cascade, PR opened -> In
// Review, merged to main -> Done, unrecoverable session failure -> Blocked).
// eve exposes no issue-state primitive - like `lib/live-sessions.ts` and the
// `commentCreate` mutation in `tools/handoff.ts`, this is hand-rolled over
// the public `callLinearGraphQL` transport. Every transition is forward-only
// and idempotent, and `advanceIssueState` never throws: a state-sync failure
// must never block or delay dispatch.

export type IssueStateTarget = "inProgress" | "inReview" | "done" | "blocked";

export interface WorkflowState {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly position: number;
}

// Linear workflow-state types, ordered by lifecycle progression. Unknown
// types (a future Linear addition) rank 0 so a transition toward them can
// only ever be skipped, never downgrade an issue.
const STATE_TYPE_RANK: Record<string, number> = {
  backlog: 0,
  canceled: 2,
  completed: 2,
  started: 1,
  triage: 0,
  unstarted: 0,
};

const rank = (state: WorkflowState): number => STATE_TYPE_RANK[state.type] ?? 0;

/** Resolves a team's concrete state for a lifecycle target; null means the team has no such state and the transition is skipped. */
export const pickTargetState = (
  states: readonly WorkflowState[],
  target: IssueStateTarget,
): WorkflowState | null => {
  const sorted = [...states].sort((a, b) => a.position - b.position);
  switch (target) {
    case "inProgress":
      return sorted.find((state) => state.type === "started") ?? null;
    case "inReview":
      return (
        sorted.find(
          (state) => state.type === "started" && /review/i.test(state.name),
        ) ?? null
      );
    case "done":
      return sorted.find((state) => state.type === "completed") ?? null;
    case "blocked":
      return sorted.find((state) => /blocked/i.test(state.name)) ?? null;
  }
};

/** Forward-only: a transition never downgrades an issue and never resurrects a completed/canceled one. */
export const shouldMove = (
  current: WorkflowState,
  target: WorkflowState,
  kind: IssueStateTarget,
): boolean => {
  if (current.id === target.id) return false;
  if (kind === "blocked") return rank(current) < 2;
  if (rank(target) > rank(current)) return true;
  // ponytail: within started-type states, board position is taken as the
  // progression order (In Progress before In Review, Linear's default).
  // Ceiling: a team whose board orders review ahead of progress skips the
  // In Review transition - benign, never a downgrade. Upgrade path:
  // name-aware ordering if a real team ever hits it.
  return (
    rank(target) === rank(current) &&
    current.type === "started" &&
    target.type === "started" &&
    target.position > current.position
  );
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readState = (value: unknown): WorkflowState | null =>
  isPlainObject(value) &&
  typeof value.id === "string" &&
  typeof value.name === "string" &&
  typeof value.type === "string" &&
  typeof value.position === "number"
    ? {
        id: value.id,
        name: value.name,
        position: value.position,
        type: value.type,
      }
    : null;

const readStates = (value: unknown): readonly WorkflowState[] =>
  Array.isArray(value)
    ? value.flatMap((node) => {
        const state = readState(node);
        return state === null ? [] : [state];
      })
    : [];

interface IssueStateSyncData {
  issue?: {
    id?: string;
    state?: unknown;
    parent?: {
      id?: string;
      state?: unknown;
      team?: { states?: { nodes?: unknown } };
    } | null;
    team?: { states?: { nodes?: unknown } };
  };
}

// Independently fail-open per mutation: the parent cascade still runs when
// the issue's own update fails, and vice versa.
const updateIssueState = async (
  credentials: LinearChannelConfig["credentials"],
  id: string,
  stateId: string,
): Promise<void> => {
  try {
    await callLinearGraphQL({
      credentials,
      query: `
        mutation IssueStateUpdate($id: String!, $input: IssueUpdateInput!) {
          issueUpdate(id: $id, input: $input) { success }
        }
      `,
      queryName: "IssueStateUpdate",
      variables: { id, input: { stateId } },
    });
  } catch (error) {
    console.warn("issue-state: update failed (fail-open)", { error, id });
  }
};

/**
 * Moves an issue (by UUID or identifier like "HAR-32") to the lifecycle
 * target's state, forward-only, cascading In Progress to an unstarted
 * parent. Never throws - fail-open is this module's contract, not the
 * caller's job.
 */
export const advanceIssueState = async (input: {
  readonly credentials: LinearChannelConfig["credentials"];
  readonly issueRef: string;
  readonly target: IssueStateTarget;
}): Promise<void> => {
  try {
    const data = await callLinearGraphQL<IssueStateSyncData>({
      credentials: input.credentials,
      query: `
        query IssueStateSync($issueRef: String!) {
          issue(id: $issueRef) {
            id
            state { id name type position }
            parent {
              id
              state { id name type position }
              team { states(first: 50) { nodes { id name type position } } }
            }
            team { states(first: 50) { nodes { id name type position } } }
          }
        }
      `,
      queryName: "IssueStateSync",
      variables: { issueRef: input.issueRef },
    });
    const issue = data.issue;
    const current = readState(issue?.state);
    if (typeof issue?.id === "string" && current !== null) {
      const target = pickTargetState(
        readStates(issue.team?.states?.nodes),
        input.target,
      );
      if (target !== null && shouldMove(current, target, input.target)) {
        await updateIssueState(input.credentials, issue.id, target.id);
      }
    }
    if (input.target !== "inProgress") return;
    const parent = issue?.parent;
    const parentState = readState(parent?.state);
    if (
      typeof parent?.id !== "string" ||
      parentState === null ||
      rank(parentState) !== 0
    ) {
      return;
    }
    const parentTarget = pickTargetState(
      readStates(parent.team?.states?.nodes),
      "inProgress",
    );
    if (
      parentTarget !== null &&
      shouldMove(parentState, parentTarget, "inProgress")
    ) {
      await updateIssueState(input.credentials, parent.id, parentTarget.id);
    }
  } catch (error) {
    console.warn("issue-state: sync failed (fail-open)", {
      error,
      issueRef: input.issueRef,
      target: input.target,
    });
  }
};
