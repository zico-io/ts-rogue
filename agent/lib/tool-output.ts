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
