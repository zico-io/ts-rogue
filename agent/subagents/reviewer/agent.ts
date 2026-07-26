import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Ponytail-reviews one pull request: fetches its diff, applies the over-engineering and conventions/stack-idioms lenses, and posts the findings as one GitHub pull-request review with inline comments anchored to added or changed diff lines. One PR per invocation - review, post, stop. No Linear interaction.",
  model: "anthropic/claude-sonnet-5",
});
