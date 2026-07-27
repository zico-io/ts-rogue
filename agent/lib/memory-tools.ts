import { z } from "zod";

import type { Memory, MemoryStore } from "./memory-store";
import { memoryStore } from "./memory-store";

/**
 * Validation and pass-through logic behind `agent/tools/remember.ts`,
 * `recall.ts`, and `forget.ts`. Lives here (rather than in `agent/tools/`)
 * so it can be unit tested: eve treats every file directly under
 * `agent/tools/` as a tool definition, so a colocated `*.test.ts` file
 * there fails discovery.
 */

/**
 * Closed set of categories the runtime memory store accepts (HAR-75). Keeps
 * the store queryable and matches the vocabulary already used in
 * `instructions.md` and `agent/README.md`. Extend deliberately - this is a
 * product decision, not free text the model can invent per call.
 */
export const MEMORY_CATEGORIES = ["workaround", "debugging-note", "entity"] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

/**
 * Heuristic patterns for content that must never enter the runtime memory
 * store (HAR-75): credentials, tokens, and a couple of common PII shapes.
 * This is a denylist of recognizable secret/PII *shapes*, not a general
 * secret scanner - it backstops the `instructions.md` prose warning with
 * real input validation, matching `.botfile` provenance discipline.
 */
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
      .regex(/^[a-z0-9_.-]+$/, "use lowercase letters, digits, '.', '_', or '-'"),
    value: z.string().min(1).max(4000),
    category: z.enum(MEMORY_CATEGORIES).describe(`One of: ${MEMORY_CATEGORIES.join(", ")}.`),
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
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: SENSITIVE_CONTENT_MESSAGE });
      }
    }
  });
export type RememberInput = z.infer<typeof rememberInputSchema>;

export async function rememberExecute(
  input: RememberInput,
  store: MemoryStore = memoryStore,
): Promise<Memory> {
  return await store.put(input);
}

const DEFAULT_RECALL_LIMIT = 50;

export const recallInputSchema = z.object({
  category: z
    .enum(MEMORY_CATEGORIES)
    .optional()
    .describe("Only return memories saved under this category."),
  limit: z.number().int().min(1).max(200).default(DEFAULT_RECALL_LIMIT),
});
export type RecallInput = z.infer<typeof recallInputSchema>;

export async function recallExecute(
  { category, limit }: RecallInput,
  store: MemoryStore = memoryStore,
): Promise<Memory[]> {
  return await store.list({ category, limit });
}

export const forgetInputSchema = z.object({ key: z.string().min(1).max(80) });
export type ForgetInput = z.infer<typeof forgetInputSchema>;

export async function forgetExecute(
  { key }: ForgetInput,
  store: MemoryStore = memoryStore,
): Promise<{ deleted: boolean }> {
  const deleted = await store.delete(key);
  return { deleted };
}
