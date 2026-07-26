import { defineEval } from "eve/evals";
















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


    t.calledTool("Workflow", { count: 1 });



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




    t.calledSubagent("reviewer", { count: 2 });
  },
});
