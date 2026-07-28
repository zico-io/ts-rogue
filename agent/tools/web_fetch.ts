import { defineTool } from "eve/tools";
import { webFetch } from "eve/tools/defaults";

import { flagField, scalarField, textField } from "../lib/tool-output";
import { truncateForContext } from "../lib/truncate-for-context";

// Overrides the framework `web_fetch` tool (slug = filename). Same mechanism as
// `bash.ts`: spread the default, inherit `execute`, reshape only the
// model-facing result; Linear chips (fed by `action.result`) still get the full
// output. `content` is the unbounded field (a whole page converted to
// markdown/text); `url`, `contentType`, and `truncated` are small and preserved
// so the model still knows what it fetched and whether the fetcher already
// capped the body. eve types this output as `unknown`, so the fields are read
// rather than asserted - see `lib/tool-output.ts`.
export default defineTool({
  ...webFetch,
  toModelOutput(output) {
    const fetcherTruncated = flagField(output, "truncated")
      ? " (truncated by fetcher)"
      : "";
    const meta =
      `url: ${scalarField(output, "url")}\n` +
      `contentType: ${scalarField(output, "contentType")}${fetcherTruncated}`;
    return {
      type: "text",
      value: `${meta}\n\n${truncateForContext(textField(output, "content"))}`,
    };
  },
});
