import { defineDynamic } from "eve/instructions";

import { resolveMemoryInstructions } from "../lib/memory/instructions";

export default defineDynamic({
  events: {
    "turn.started": async () => resolveMemoryInstructions(),
  },
});
