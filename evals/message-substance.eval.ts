import { defineEval } from "eve/evals";

const PROCESS_RECITAL =
  /orientation\.md|sub-issue check|coding child|\bsizing\b|\bscoping\b|tool batch|pnpm check/i;
const LEADING_HEADER =
  /^\s*(?:#{1,6}\s+|(?:\*\*|__)[^\n]+(?:\*\*|__)\s*(?:\n|$))/u;

export default defineEval({
  description:
    "human-facing messages are concise, headerless, and substantive",
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
          (event) => {
            const message = event.data.message ?? "";
            return (
              message.length <= 500 &&
              !LEADING_HEADER.test(message) &&
              !/\n{3,}/u.test(message) &&
              !PROCESS_RECITAL.test(message) &&
              /gold|hud|status bar/i.test(message)
            );
          },
        ),
    );
  },
});
