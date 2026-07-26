import { defineEval } from "eve/evals";















const isSessionUpdate = (toolName: string) =>
  toolName.endsWith("session_update");



const listsWorkstreams = (message: string): boolean =>
  message
    .split("\n")
    .filter((line) => /^\s*(?:[-*]|\d+[.)])\s+\S/.test(line)).length >= 2;

export default defineEval({
  description:
    "a large multi-deliverable ticket parks on an approval request with a breakdown proposal instead of being implemented directly",
  async test(t) {
    await t.send(
      [
        "You have been assigned this Linear issue. Drive it.",
        "",
        "issue: ROG-98 - Overworld travel overhaul: fast travel, random encounters, weather, and map UI",
        "description: Four independent systems land under this ticket:",
        "1. Fast travel between visited landmarks (new engine event, picker UI in both renderers).",
        "2. Random encounter tables per overworld biome (new engine subsystem, data-driven).",
        "3. A weather system that modifies encounter rates and movement cost (engine + rendering in both UIs).",
        "4. A full-screen map UI with pan/zoom and legend (new screen in both renderers).",
        "acceptance criteria: each of the four systems is playable and tested; each lands with its own docs and changeset.",
        "branch: rog-98-overworld-travel-overhaul",
        "repo state: on main, HEAD clean, main synced",
        "agent_session_id: eval-scoping-rog-98",
        "",
        "This issue has no sub-issues and no parent.",
      ].join("\n"),
    );



    t.parked();


    t.calledSubagent("agent", { count: 0 });

    t.eventsSatisfy(
      "creates no branch, worktree, or claim push before approval",
      (events) =>
        events.every(
          (event) =>
            !/checkout\s+-b|switch\s+-c|worktree\s+add|git\s+push/i.test(
              JSON.stringify(event),
            ),
        ),
    );

    t.eventsSatisfy("creates no sub-issues before approval", (events) =>
      events.every((event) => !/save_issue/i.test(JSON.stringify(event))),
    );

    t.eventsSatisfy(
      "posts a review session_update proposing a multi-workstream breakdown",
      (events) => {
        const updates = events.flatMap((event) =>
          event.type === "actions.requested"
            ? event.data.actions.flatMap((action) =>
                action.kind === "tool-call" && isSessionUpdate(action.toolName)
                  ? [action.input as { status?: unknown; message?: unknown }]
                  : [],
              )
            : [],
        );
        return updates.some(
          (input) =>
            input.status === "review" &&
            listsWorkstreams(String(input.message ?? "")),
        );
      },
    );
  },
});
