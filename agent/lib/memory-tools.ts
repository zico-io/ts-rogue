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

export const rememberInputSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9_.-]+$/, "use lowercase letters, digits, '.', '_', or '-'"),
  value: z.string().min(1).max(4000),
  category: z
    .string()
    .min(1)
    .max(40)
    .describe(
      'A short label such as "workaround", "entity", or "debugging-note".',
    ),
  source: z
    .string()
    .min(1)
    .max(200)
    .describe(
      "Provenance: the session, issue, or investigation that produced this fact.",
    ),
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
    .string()
    .min(1)
    .max(40)
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
