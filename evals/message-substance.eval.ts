import { defineEval } from "eve/evals";

const PROCESS_RECITAL =
  /orientation\.md|sub-issue check|coding child|\bsizing\b|\bscoping\b|tool batch|pnpm check/i;

export default defineEval({
  description:
    "human-facing messages describe the work without reciting internal procedure",
  async test(t) {
    await t.send(
      [
        "You have been assigned ROG-99: show the player's gold beside HP in the HUD.",
        "Explain the intended product change and the next meaningful step, then stop. Do not edit files.",
      ].join("\n"),
    );

    t.succeeded();
    t.eventsSatisfy("messages stay substantive", (events) =>
      events
        .filter((event) => event.type === "message.completed")
        .every(
          (event) =>
            !PROCESS_RECITAL.test(event.data.message ?? "") &&
            /gold|hud|status bar/i.test(event.data.message ?? ""),
        ),
    );
  },
});
