// Reading a framework tool's output inside a `toModelOutput` override.
//
// eve declares its defaults as `ToolDefinition` - that is
// `ToolDefinition<unknown, unknown>` - so an override has no inferred output
// shape to reuse and nothing to validate against. Asserting a hand-rolled
// interface instead would put a crash in a hot path: if eve renames or retypes a
// field, `output.stdout.length` throws inside every single tool call. These read
// what they need without asserting a shape, so a change in eve degrades the
// model-facing projection to a placeholder rather than failing the turn.

const fields = (output: unknown): Record<string, unknown> =>
  typeof output === "object" && output !== null
    ? (output as Record<string, unknown>)
    : {};

/** A text field, or `""` when it is absent or not a string. */
export const textField = (output: unknown, key: string): string => {
  const value = fields(output)[key];
  return typeof value === "string" ? value : "";
};

/** A scalar rendered into a header line, or `"unknown"` when unreadable. */
export const scalarField = (output: unknown, key: string): string => {
  const value = fields(output)[key];
  return typeof value === "number" || typeof value === "string"
    ? String(value)
    : "unknown";
};

/** True only for a literal `true`, so a missing flag reads as "not truncated". */
export const flagField = (output: unknown, key: string): boolean =>
  fields(output)[key] === true;
