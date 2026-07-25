import { defineAgent } from "eve";

export default defineAgent({
  // Reviewing is read-and-post, not planning or writing code - a capable
  // model that follows the lens instructions precisely matters more than
  // deep reasoning, and this mirrors the root's own "strong model" choice
  // for the same reason the root avoids a weak model for judgment calls.
  description:
    "Ponytail-reviews one pull request: fetches its diff, applies the over-engineering and conventions/stack-idioms lenses, and posts the findings as one GitHub pull-request review with inline comments anchored to added or changed diff lines. One PR per invocation - review, post, stop. No Linear interaction.",
  model: "anthropic/claude-sonnet-5",
});
