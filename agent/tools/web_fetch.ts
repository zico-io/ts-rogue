import { defineTool } from "eve/tools";
import { webFetch } from "eve/tools/defaults";

import { truncateForContext } from "../lib/truncate-for-context";

// Overrides the framework `web_fetch` tool (slug = filename). Same mechanism as
// `bash.ts`: spread the default, inherit `execute`, reshape only the
// model-facing result; Linear chips (fed by `action.result`) still get the full
// output. `content` is the unbounded field (a whole page converted to
// markdown/text); `url`, `contentType`, and `truncated` are small and preserved
// so the model still knows what it fetched and whether the fetcher already
// capped the body.
interface WebFetchOutput {
  readonly content: string;
  readonly contentType: string;
  readonly truncated: boolean;
  readonly url: string;
}

export default defineTool({
  ...webFetch,
  toModelOutput(output) {
    const { content, contentType, truncated, url } = output as WebFetchOutput;
    const meta =
      `url: ${url}\n` +
      `contentType: ${contentType}${truncated ? " (truncated by fetcher)" : ""}`;
    return {
      type: "text",
      value: `${meta}\n\n${truncateForContext(content)}`,
    };
  },
});
