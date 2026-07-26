import { defineEval } from "eve/evals";

// Verifies the model can use the Workflow tool with Promise.all to dispatch
// multiple independent subagent calls concurrently. This guards the
// documentation added to agent/instructions.md's Delegation section (HAR-43):
// the orchestrator should reach for Promise.all inside a Workflow program
// when work items have no ordering dependency, such as reviewing several
// open pull requests in parallel.
//
// Runs without a mock-model flag like message-substance.eval.ts and
// scoping.eval.ts: the synthetic turn packet drives the real model, so this
// eval checks model behavior against the documented policy. The Workflow
// tool must be enabled (agent/tools/workflow.ts) and subagents declared.
//
// It does not assert noFailedActions (session_update may fire against real
// Linear with a synthetic session id, matching scoping.eval.ts's precedent).

const isWorkflowTool = (toolName: string) => toolName === "Workflow";

export default defineEval({
  description:
    "the model uses a Workflow tool with Promise.all to fan out independent subagent calls in parallel",
  timeoutMs: 120_000,
  async test(t) {
    await t.send(
      [
        "You have been assigned this task. Drive it.",
        "",
        "Two open pull requests need a ponytail review this morning:",
        "  PR #42 (feature/gold-pickup) by alice -- adds gold pickup to the dungeon.",
        "  PR #43 (fix/map-crash) by bob -- fixes a crash when opening the map in the village.",
        "",
        "Both are independent, non-overlapping reviews. Review both efficiently.",
        "The PR numbers, diff-fetch commands, the two lenses, and the posting",
        "endpoint/JSON are standard -- use the usual review context pattern.",
        "There is no Linear issue for this task and no agent_session_id.",
      ].join("\n"),
    );

    t.succeeded();

    // The Workflow tool must have been called at least once.
    t.calledTool("Workflow", { count: 1 });

    // The JS program inside the Workflow call must use Promise.all to
    // dispatch both reviewer calls concurrently.
    t.eventsSatisfy(
      "the Workflow tool received a JS program using Promise.all for independent reviewer calls",
      (events) =>
        events.some((event) => {
          if (event.type !== "actions.requested") return false;
          return event.data.actions.some(
            (action) =>
              action.kind === "tool-call" &&
              isWorkflowTool(action.toolName) &&
              typeof action.input === "object" &&
              action.input !== null &&
              "js" in action.input &&
              typeof (action.input as Record<string, unknown>).js ===
                "string" &&
              (action.input as Record<string, unknown>).js.includes(
                "Promise.all",
              ),
          );
        }),
    );

    // Both reviewer subagent calls should have been dispatched (each gets a
    // subagent.called event in the root session, bridged from the Workflow
    // sandbox).
    t.calledSubagent("reviewer", { count: 2 });
  },
});
