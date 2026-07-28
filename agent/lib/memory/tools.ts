import { z } from "zod";

// Input validation behind the memory tools; lives here so it can be unit tested.

/** Closed set of categories the runtime memory store accepts (HAR-75). */
export const MEMORY_CATEGORIES = [
  "workaround",
  "debugging-note",
  "entity",
] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

/** Recognizable secret and PII shapes, not a general secret scanner (HAR-75). */
const SENSITIVE_CONTENT_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, // PEM private key block
  /\bsk-[A-Za-z0-9]{20,}\b/, // OpenAI-style secret key
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/i, // GitHub personal/app/OAuth token
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key ID
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, // Slack token
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, // JWT
  /\b\d{3}-\d{2}-\d{4}\b/, // US Social Security Number
  /(password|passwd|api[_-]?key|access[_-]?token|auth[_-]?token|secret)\s*[:=]\s*\S{6,}/i,
];

/** Whether `text` looks like a credential, token, or other sensitive value. */
export function containsSensitiveContent(text: string): boolean {
  return SENSITIVE_CONTENT_PATTERNS.some((pattern) => pattern.test(text));
}

const SENSITIVE_CONTENT_MESSAGE =
  "looks like a credential, token, or other sensitive value; runtime memory must never store these";

export const rememberInputSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .max(80)
      .regex(
        /^[a-z0-9_.-]+$/,
        "use lowercase letters, digits, '.', '_', or '-'",
      ),
    value: z.string().min(1).max(4000),
    category: z
      .enum(MEMORY_CATEGORIES)
      .describe(`One of: ${MEMORY_CATEGORIES.join(", ")}.`),
    source: z
      .string()
      .min(1)
      .max(200)
      .describe(
        "Provenance: the session, issue, or investigation that produced this fact.",
      ),
  })
  .superRefine((data, ctx) => {
    for (const field of ["key", "value", "source"] as const) {
      if (containsSensitiveContent(data[field])) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: SENSITIVE_CONTENT_MESSAGE,
        });
      }
    }
  });
export type RememberInput = z.infer<typeof rememberInputSchema>;

const DEFAULT_RECALL_LIMIT = 50;

export const recallInputSchema = z.object({
  category: z
    .enum(MEMORY_CATEGORIES)
    .optional()
    .describe("Only return memories saved under this category."),
  limit: z.number().int().min(1).max(200).default(DEFAULT_RECALL_LIMIT),
});
export type RecallInput = z.infer<typeof recallInputSchema>;

export const forgetInputSchema = z.object({ key: z.string().min(1).max(80) });
export type ForgetInput = z.infer<typeof forgetInputSchema>;
