import { defineTool } from "eve/tools";
import { bash } from "eve/tools/defaults";

import { flagField, scalarField, textField } from "../lib/tool-output";
import { truncateForContext } from "../lib/truncate-for-context";

/** eve's `bash` with only `toModelOutput` replaced; `action.result` still gets the full output. */
export default defineTool({
  ...bash,
  toModelOutput(output) {
    const stderr = textField(output, "stderr");
    const stdout = textField(output, "stdout");
    const sandboxTruncated = flagField(output, "truncated")
      ? " (output truncated by sandbox)"
      : "";
    const sections = [
      `exit code: ${scalarField(output, "exitCode")}${sandboxTruncated}`,
      `stdout:\n${stdout.length > 0 ? truncateForContext(stdout) : "(empty)"}`,
    ];
    if (stderr.length > 0) {
      sections.push(`stderr:\n${truncateForContext(stderr)}`);
    }
    return { type: "text", value: sections.join("\n\n") };
  },
});
