import { defineTool } from "eve/tools";

import { memoryStore } from "../lib/memory/store";
import { forgetInputSchema } from "../lib/memory/tools";

export default defineTool({
  description:
    "Delete one fact from Eve's cross-session runtime memory by its key. " +
    "Deletion is autonomous and needs no approval.",
  inputSchema: forgetInputSchema,
  async execute({ key }) {
    return { deleted: await memoryStore.delete(key) };
  },
});
