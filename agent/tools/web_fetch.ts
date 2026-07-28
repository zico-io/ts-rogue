import { defineTool } from "eve/tools";
import { webFetch } from "eve/tools/defaults";

import { flagField, scalarField, textField } from "../lib/tool-output";
import { truncateForContext } from "../lib/truncate-for-context";

/** eve's `web_fetch` with only `toModelOutput` replaced; same mechanism as `bash.ts`. */
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
