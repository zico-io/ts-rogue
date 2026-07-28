import { defineTool } from "eve/tools";

import { memoryStore } from "../lib/memory/store";
import { rememberInputSchema } from "../lib/memory/tools";

export default defineTool({
  description:
    "Save one durable operational fact to Eve's cross-session runtime memory - " +
    "a debugging insight, a workaround, an entity-dedup note, or similar " +
    "low-stakes context that would help a future session. This is not the " +
    "reviewed shipped-behavior record (`.botfile/memory/domain/`). " +
    "`category` must be one of the allowed values. A value that looks like a " +
    "password, access token, private key, or other credential or personal " +
    "data is rejected, not merely discouraged. Writing is autonomous and " +
    "needs no approval. Reusing an existing key overwrites that memory's " +
    "value, category, and source. The store keeps a bounded number of " +
    "memories and silently drops the least-recently-updated one once full.",
  inputSchema: rememberInputSchema,
  execute: (input) => memoryStore.put(input),
});
