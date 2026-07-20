import { defineAgent, defineDynamic } from "eve";

export const codingWorkerModel = (event: unknown) =>
  (event as { data?: { invocation?: unknown } }).data?.invocation
    ? { model: "deepseek/deepseek-v4-flash", modelContextWindowTokens: 1_000_000 }
    : null;

export default defineAgent({
  model: defineDynamic({
    fallback: "zai/glm-5.2",
    events: { "session.started": codingWorkerModel },
  }),
  modelContextWindowTokens: 1_040_000,
});
