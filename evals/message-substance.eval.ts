import { defineEval } from "eve/evals";

// Regression guard for the "regurgitation" fix: Eve's user-facing messages must
// describe the work and its status, not recite the contract's own mechanics.
// The symptom was a `started` session_update that read "Plan: check for
// sub-issues, read ORIENTATION.md, ... delegate to one coding child" - the
// agent parroting its orientation/delegation procedure back at the reader
// because the runtime prompt was dense with that meta-language. instructions.md
// now keeps its message rules terse and holds the rationale in agent/README.md.
//
// This asserts the opening message is substantive: a `started` session_update
// is posted, and no session_update recites the clearest procedure tells. It
// scans raw stream events (via eventsSatisfy) so it is robust to how the
// session_update tool is namespaced.

// The clearest procedure tells - none of these belong in a message about the
// actual change. Deliberately narrow to avoid false positives on issues whose
// subject legitimately involves delegation or batching.
const PROCESS_RECITAL = /orientation\.md|sub-issue|coding child/i;

const isSessionUpdate = (toolName: string) =>
  toolName.endsWith("session_update");

export default defineEval({
  description:
    "the opening session_update describes the work, not the contract's own orientation/delegation procedure",
  async test(t) {
    await t.send(
      [
        "You have been assigned this Linear issue. Post your opening session_update for it, then stop and wait for confirmation before doing anything else.",
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
      "opens with a started session_update that describes the work, not the procedure",
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
        const opened = updates.some((input) => input.status === "started");
        const clean = updates.every(
          (input) => !PROCESS_RECITAL.test(String(input.message ?? "")),
        );
        return opened && clean;
      },
    );
  },
});
