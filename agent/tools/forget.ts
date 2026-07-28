import { defineTool } from "eve/tools";

import { forgetExecute, forgetInputSchema } from "../lib/memory";

export default defineTool({
  description:
    "Delete one fact from Eve's cross-session runtime memory by its key. " +
    "Deletion is autonomous and needs no approval.",
  inputSchema: forgetInputSchema,
  async execute(input) {
    return await forgetExecute(input);
  },
});
