const NO_USAGE = {
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
} as const;

/**
 * Builds a `subagent-result` action result for tests. eve 0.52 made `origin`
 * and `outcome` required on the child variant; the code under test only reads
 * `callId`, `subagentName`, and `output`, so the rest is a fixed envelope.
 */
export const subagentResult = <TOutput>(input: {
  callId: string;
  output: TOutput;
  subagentName: string;
}) =>
  ({
    callId: input.callId,
    kind: "subagent-result",
    origin: "child",
    outcome: {
      kind: "terminal",
      result: { kind: "succeeded", output: input.output },
      usageDelta: NO_USAGE,
    },
    output: input.output,
    subagentName: input.subagentName,
  }) as const;
