import { defineEval } from "eve/evals";

// Verifies the model reaches for the Workflow tool with Promise.all to fan
// out several independent `agent` calls concurrently, then synthesizes their
// results. Guards agent/tools/workflow.ts (HAR-67): the Workflow tool is
// re-enabled with no declared subagents beyond the built-in `agent`, so
// `experimental_workflow()`'s default callable set (`["agent"]`) must still
// be enough to make fan-out worth reaching for.
//
// Runs without a mock-model flag like message-substance.eval.ts and
// scoping.eval.ts: the synthetic turn packet drives the real model, so this
// eval checks model behavior against the documented policy. It does not
// assert noFailedActions (session_update may fire against real Linear with a
// synthetic session id, matching scoping.eval.ts's precedent).

const isWorkflowTool = (toolName: string) => toolName === "Workflow";

export default defineEval({
  description:
    "the model uses a Workflow tool with Promise.all to fan out independent agent calls in parallel",
  timeoutMs: 120_000,
  async test(t) {
    await t.send(
      [
        "You have been assigned this task. Drive it.",
        "",
        "A pushed branch (feature/loot-filter) needs a quick multi-lens gut",
        "check before it goes to human review. Correctness, security, and",
        "performance are three independent lenses over the same diff, with",
        "no ordering dependency between them. Fetch the diff once",
        "(git fetch origin feature/loot-filter, then",
        "git diff main...origin/feature/loot-filter), gather all three",
        "lenses' findings, then synthesize them into one pass/fail verdict",
        "naming any blocking issues.",
        "",
        "There is no Linear issue for this task and no agent_session_id.",
      ].join("\n"),
    );

    t.succeeded();

    // The Workflow tool must have been called at least once.
    t.calledTool("Workflow", { count: 1 });

    // The JS program inside the Workflow call must use Promise.all to
    // dispatch the independent lens calls concurrently.
    t.eventsSatisfy(
      "the Workflow tool received a JS program using Promise.all for independent agent calls",
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

    // At least the three independent lens calls should have been dispatched
    // through the built-in `agent` tool (each gets a subagent.called event in
    // the root session, bridged from the Workflow sandbox).
    t.calledSubagent("agent", { count: (count) => count >= 3 });
  },
});
