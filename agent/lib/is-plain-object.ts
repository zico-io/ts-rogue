/** Narrows to a plain object (not null, not an array) for defensive reads of untyped webhook and GraphQL payloads. */
export const isPlainObject = (
  value: unknown,
): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
