import { defineDynamic } from "eve/instructions";

import { resolveMemoryInstructions } from "../lib/memory/instructions";

export default defineDynamic({
  events: {
    // Resolved fresh every turn so later turns in the same session see
    // memories a tool call wrote earlier in that same session.
    "turn.started": async () => resolveMemoryInstructions(),
  },
});
