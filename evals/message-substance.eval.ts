import { defineEval } from "eve/evals";

// Regression guard for the "regurgitation" fix and the plan-first opening
// (HAR-40): Eve's user-facing surfaces must describe the work, not recite the
// contract's own mechanics. The original symptom was a `started`
// session_update that read "Plan: check for sub-issues, read ORIENTATION.md,
// ... delegate to one coding child". The opening mandate is now to seed the
// session's Agent Plan (the `todo` tool, mirrored into Linear by
// `syncAgentPlanFromTodoTool`), so this asserts the plan is seeded with
// substantive, work-shaped steps - and that any session_update posted stays
// recital-free. It scans raw stream events (via eventsSatisfy) so it is
// robust to how the tools are namespaced.

// The clearest procedure tells - none of these belong in a plan step or a
// message about the actual change. Deliberately narrow to avoid false
// positives on issues whose subject legitimately involves delegation or
// batching. `sizing`/`scoping` guard the HAR-9 sizing-gate vocabulary; this
// eval only drives a small ticket, where sizing must be silent (a large
// ticket's breakdown proposal is a different, legitimate message and is not
// exercised here).
const PROCESS_RECITAL =
  /orientation\.md|sub-issue|coding child|\bsizing\b|\bscoping\b/i;

const isSessionUpdate = (toolName: string) =>
  toolName.endsWith("session_update");

const isTodoTool = (toolName: string) => toolName.endsWith("todo");

export default defineEval({
  description:
    "the opening batch seeds a substantive Agent Plan and no message recites the contract's own procedure",
  async test(t) {
    await t.send(
      [
        "You have been assigned this Linear issue. Seed the session's plan for it, then stop and wait for confirmation before doing anything else.",
        "",
        "issue: ROG-99 - Show the player's gold in the HUD status bar",
        "description: The status bar renders HP but omits the player's gold. Add a gold readout beside HP so the player can see their balance at a glance.",
        "acceptance criteria: the gold total renders in the status bar and updates when gold changes.",
        "branch: rog-99-status-bar-gold",
        "repo state: on main, HEAD clean, main synced",
        "agent_session_id: eval-message-substance-rog-99",
        "",
        "This issue has no sub-issues.",
      ].join("\n"),
    );

    t.eventsSatisfy(
      "seeds a substantive plan and recites no procedure",
      (events) => {
        const calls = events.flatMap((event) =>
          event.type === "actions.requested"
            ? event.data.actions.filter(
                (action) => action.kind === "tool-call",
              )
            : [],
        );
        const seeded = calls
          .filter((action) => isTodoTool(action.toolName))
          .map((action) => action.input as { todos?: unknown })
          .some(
            (input) =>
              Array.isArray(input.todos) &&
              input.todos.length >= 2 &&
              input.todos.every((todo) => {
                const content = (todo as { content?: unknown }).content;
                return (
                  typeof content === "string" &&
                  content.trim().length > 0 &&
                  !PROCESS_RECITAL.test(content)
                );
              }),
          );
        const clean = calls
          .filter((action) => isSessionUpdate(action.toolName))
          .every(
            (action) =>
              !PROCESS_RECITAL.test(
                String((action.input as { message?: unknown }).message ?? ""),
              ),
          );
        return seeded && clean;
      },
    );
  },
});
