/** Narrows untyped input to a non-null, non-array object. */
export const isPlainObject = (
  value: unknown,
): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
