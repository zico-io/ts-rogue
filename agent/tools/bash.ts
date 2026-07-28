import { defineTool } from "eve/tools";
import { bash } from "eve/tools/defaults";

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
// sandbox-level truncation flag.
interface BashOutput {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
  readonly truncated: boolean;
}

export default defineTool({
  ...bash,
  toModelOutput(output) {
    const { exitCode, stderr, stdout, truncated } = output as BashOutput;
    const sections = [
      `exit code: ${exitCode}${truncated ? " (output truncated by sandbox)" : ""}`,
      `stdout:\n${stdout.length > 0 ? truncateForContext(stdout) : "(empty)"}`,
    ];
    if (stderr.length > 0) {
      sections.push(`stderr:\n${truncateForContext(stderr)}`);
    }
    return { type: "text", value: sections.join("\n\n") };
  },
});
