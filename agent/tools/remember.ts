import { defineTool } from "eve/tools";

import { rememberExecute, rememberInputSchema } from "../lib/memory-tools";

export default defineTool({
  description:
    "Save one durable operational fact to Eve's cross-session runtime memory - " +
    "a debugging insight, a workaround, an entity-dedup note, or similar " +
    "low-stakes context that would help a future session. This is not the " +
    'reviewed shipped-behavior record (`.botfile/memory/domain/product.md`), ' +
    "and it must never hold a password, access token, or other credential or " +
    "personal data. Writing is autonomous and needs no approval. Reusing an " +
    "existing key overwrites that memory's value, category, and source.",
  inputSchema: rememberInputSchema,
  async execute(input) {
    return await rememberExecute(input);
  },
});
