import { beforeEach, describe, expect, it, vi } from "vitest";

// Harness-owned issue lifecycle: `advanceIssueState` reads the issue (state,
// team states, parent) in one IssueStateSync query, then issues forward-only
// IssueStateUpdate mutations. The mock stands in for the Linear GraphQL
// transport so every transition path is driven without a live workspace.
const { callGraphQL } = vi.hoisted(() => ({ callGraphQL: vi.fn() }));

vi.mock("eve/channels/linear", () => ({
  callLinearGraphQL: (input: unknown) => callGraphQL(input),
}));

const { advanceIssueState, pickTargetState, shouldMove } = await import(
  "../agent/lib/issue-state"
);

import type { WorkflowState } from "../agent/lib/issue-state";

const state = (
  id: string,
  name: string,
  type: string,
  position: number,
): WorkflowState => ({ id, name, position, type });

// A default Linear team board, positions in display order.
const backlog = state("s-backlog", "Backlog", "backlog", 0);
const todo = state("s-todo", "Todo", "unstarted", 1);
const inProgress = state("s-progress", "In Progress", "started", 2);
const blocked = state("s-blocked", "Blocked", "started", 3);
const inReview = state("s-review", "In Review", "started", 4);
const done = state("s-done", "Done", "completed", 5);
const canceled = state("s-canceled", "Canceled", "canceled", 6);

const TEAM_STATES = [
  backlog,
  todo,
  inProgress,
  blocked,
  inReview,
  done,
  canceled,
];

const issueStateSyncData = (issue: unknown) => ({ issue });

const mockIssue = (input: {
  id?: string;
  state?: WorkflowState;
  parent?: {
    id: string;
    state: WorkflowState;
    states?: readonly WorkflowState[];
  } | null;
  states?: readonly WorkflowState[];
}) =>
  issueStateSyncData({
    id: input.id ?? "issue-uuid",
    state: input.state ?? todo,
    parent:
      input.parent == null
        ? null
        : {
            id: input.parent.id,
            state: input.parent.state,
            team: { states: { nodes: input.parent.states ?? TEAM_STATES } },
          },
    team: { states: { nodes: input.states ?? TEAM_STATES } },
  });

const updateCalls = () =>
  callGraphQL.mock.calls
    .map((call) => call[0])
    .filter((call) => call?.queryName === "IssueStateUpdate");

describe("pickTargetState", () => {
  it("picks the lowest-position started state for inProgress", () => {
    expect(pickTargetState(TEAM_STATES, "inProgress")).toEqual(inProgress);
  });

  it("picks the started state named like review for inReview", () => {
    expect(pickTargetState(TEAM_STATES, "inReview")).toEqual(inReview);
  });

  it("returns null for inReview when the team has no review state", () => {
    const states = [todo, inProgress, done];
    expect(pickTargetState(states, "inReview")).toBeNull();
  });

  it("picks the lowest-position completed state for done", () => {
    expect(pickTargetState(TEAM_STATES, "done")).toEqual(done);
  });

  it("picks a state named like blocked regardless of type", () => {
    const unstartedBlocked = state("s-b2", "Blocked", "unstarted", 0.5);
    expect(
      pickTargetState([todo, unstartedBlocked, inProgress], "blocked"),
    ).toEqual(unstartedBlocked);
  });

  it("returns null for blocked when the team has no blocked state", () => {
    expect(pickTargetState([todo, inProgress, done], "blocked")).toBeNull();
  });
});

describe("shouldMove (forward-only)", () => {
  it("moves an unstarted issue to In Progress", () => {
    expect(shouldMove(todo, inProgress, "inProgress")).toBe(true);
  });

  it("moves an unstarted issue straight to Done", () => {
    expect(shouldMove(todo, done, "done")).toBe(true);
  });

  it("never regresses In Review to In Progress", () => {
    expect(shouldMove(inReview, inProgress, "inProgress")).toBe(false);
  });

  it("advances In Progress to In Review by position", () => {
    expect(shouldMove(inProgress, inReview, "inReview")).toBe(true);
  });

  it("never moves a Done issue", () => {
    expect(shouldMove(done, inProgress, "inProgress")).toBe(false);
    expect(shouldMove(done, inReview, "inReview")).toBe(false);
  });

  it("never moves a Canceled issue to Done", () => {
    expect(shouldMove(canceled, done, "done")).toBe(false);
  });

  it("moves In Review to Blocked even though position goes backward", () => {
    expect(shouldMove(inReview, blocked, "blocked")).toBe(true);
  });

  it("never resurrects Done or Canceled into Blocked", () => {
    expect(shouldMove(done, blocked, "blocked")).toBe(false);
    expect(shouldMove(canceled, blocked, "blocked")).toBe(false);
  });

  it("is a no-op when the issue is already in the target state", () => {
    expect(shouldMove(inProgress, inProgress, "inProgress")).toBe(false);
    expect(shouldMove(blocked, blocked, "blocked")).toBe(false);
  });
});

describe("advanceIssueState", () => {
  beforeEach(() => {
    callGraphQL.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("queries the issue then updates it to the picked state", async () => {
    callGraphQL.mockResolvedValue(mockIssue({ state: todo }));

    await advanceIssueState({
      credentials: {},
      issueRef: "issue-uuid",
      target: "inProgress",
    });

    const sync = callGraphQL.mock.calls[0]?.[0];
    expect(sync.queryName).toBe("IssueStateSync");
    expect(sync.variables).toEqual({ issueRef: "issue-uuid" });
    expect(updateCalls()).toEqual([
      expect.objectContaining({
        variables: { id: "issue-uuid", input: { stateId: inProgress.id } },
      }),
    ]);
  });

  it("passes an identifier like HAR-32 through as the issue ref but mutates by UUID", async () => {
    callGraphQL.mockResolvedValue(mockIssue({ id: "uuid-32", state: todo }));

    await advanceIssueState({
      credentials: {},
      issueRef: "HAR-32",
      target: "done",
    });

    expect(callGraphQL.mock.calls[0]?.[0].variables).toEqual({
      issueRef: "HAR-32",
    });
    expect(updateCalls()[0]?.variables.id).toBe("uuid-32");
  });

  it("skips the mutation when the transition would not be forward", async () => {
    callGraphQL.mockResolvedValue(mockIssue({ state: inReview }));

    await advanceIssueState({
      credentials: {},
      issueRef: "issue-uuid",
      target: "inProgress",
    });

    expect(updateCalls()).toEqual([]);
  });

  it("skips silently when the team lacks the target state", async () => {
    callGraphQL.mockResolvedValue(
      mockIssue({ state: inProgress, states: [todo, inProgress, done] }),
    );

    await advanceIssueState({
      credentials: {},
      issueRef: "issue-uuid",
      target: "inReview",
    });

    expect(updateCalls()).toEqual([]);
  });

  it("cascades In Progress to an unstarted parent using the parent team's states", async () => {
    const parentProgress = state("p-progress", "Doing", "started", 1);
    callGraphQL.mockResolvedValue(
      mockIssue({
        state: todo,
        parent: {
          id: "parent-uuid",
          state: state("p-todo", "Todo", "unstarted", 0),
          states: [state("p-todo", "Todo", "unstarted", 0), parentProgress],
        },
      }),
    );

    await advanceIssueState({
      credentials: {},
      issueRef: "issue-uuid",
      target: "inProgress",
    });

    expect(updateCalls()).toEqual([
      expect.objectContaining({
        variables: { id: "issue-uuid", input: { stateId: inProgress.id } },
      }),
      expect.objectContaining({
        variables: { id: "parent-uuid", input: { stateId: parentProgress.id } },
      }),
    ]);
  });

  it("leaves a parent already started alone", async () => {
    callGraphQL.mockResolvedValue(
      mockIssue({
        state: todo,
        parent: { id: "parent-uuid", state: inProgress },
      }),
    );

    await advanceIssueState({
      credentials: {},
      issueRef: "issue-uuid",
      target: "inProgress",
    });

    expect(updateCalls()).toHaveLength(1);
  });

  it("cascades to the parent even when the sub-issue itself needs no move", async () => {
    callGraphQL.mockResolvedValue(
      mockIssue({
        state: inProgress,
        parent: { id: "parent-uuid", state: todo },
      }),
    );

    await advanceIssueState({
      credentials: {},
      issueRef: "issue-uuid",
      target: "inProgress",
    });

    expect(updateCalls()).toEqual([
      expect.objectContaining({
        variables: { id: "parent-uuid", input: { stateId: inProgress.id } },
      }),
    ]);
  });

  it("never cascades for non-inProgress targets", async () => {
    callGraphQL.mockResolvedValue(
      mockIssue({
        state: inReview,
        parent: { id: "parent-uuid", state: todo },
      }),
    );

    await advanceIssueState({
      credentials: {},
      issueRef: "issue-uuid",
      target: "done",
    });

    expect(updateCalls()).toEqual([
      expect.objectContaining({
        variables: { id: "issue-uuid", input: { stateId: done.id } },
      }),
    ]);
  });

  it("fails open when the query rejects", async () => {
    callGraphQL.mockRejectedValue(new Error("Linear is down"));

    await expect(
      advanceIssueState({
        credentials: {},
        issueRef: "issue-uuid",
        target: "inProgress",
      }),
    ).resolves.toBeUndefined();
    expect(updateCalls()).toEqual([]);
  });

  it("fails open when a mutation rejects, still running the parent cascade", async () => {
    callGraphQL.mockImplementation(async (call: { queryName: string }) => {
      if (call.queryName === "IssueStateSync") {
        return mockIssue({
          state: todo,
          parent: { id: "parent-uuid", state: todo },
        });
      }
      throw new Error("mutation failed");
    });

    await expect(
      advanceIssueState({
        credentials: {},
        issueRef: "issue-uuid",
        target: "inProgress",
      }),
    ).resolves.toBeUndefined();
    expect(updateCalls()).toHaveLength(2);
  });
});
