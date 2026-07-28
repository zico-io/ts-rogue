import { defineTool } from "eve/tools";
import { bash } from "eve/tools/defaults";

import { flagField, scalarField, textField } from "../lib/tool-output";
import { truncateForContext } from "../lib/truncate-for-context";

// Overrides the framework `bash` tool (slug = filename): the resolver drops any
// framework default whose name matches an authored tool, so spreading the
// import and adding `toModelOutput` replaces it rather than duplicating it.
// `execute` (and its sandbox behavior) is inherited untouched; we only reshape
// what the MODEL sees. Channel `action.result` handlers - and therefore the
// Linear activity chips - still receive the full `execute` output.
//
// `stdout`/`stderr` are the unbounded fields; `exitCode` and `truncated` are
// small and kept verbatim so the model still sees the command's result and any
// sandbox-level truncation flag. eve types this output as `unknown`, so the
// fields are read rather than asserted - see `lib/tool-output.ts`.
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
