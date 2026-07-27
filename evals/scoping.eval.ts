import { defineEval } from "eve/evals";

export default defineEval({
  description:
    "a multi-deliverable request proposes a breakdown before creating records or implementing",
  async test(t) {
    await t.send(
      [
        "You have been assigned ROG-98. Drive it.",
        "",
        "The issue requests four independently shippable systems:",
        "1. Fast travel between visited landmarks.",
        "2. Random encounter tables per biome.",
        "3. Weather that changes encounters and movement.",
        "4. A full-screen map with pan, zoom, and legend.",
        "",
        "Each system needs its own docs and changeset. There are no sub-issues.",
      ].join("\n"),
    );

    t.parked();
    t.calledSubagent("scoper", { count: 1 });
    t.calledSubagent("agent", { count: 0 });
    t.messageIncludes(/fast travel/i);
    t.messageIncludes(/weather/i);
    t.eventsSatisfy("makes no repository or Linear writes before approval", (events) =>
      events.every(
        (event) =>
          !/checkout\s+-b|switch\s+-c|worktree\s+add|git\s+push|save_issue/i.test(
            JSON.stringify(event),
          ),
      ),
    );
  },
});
