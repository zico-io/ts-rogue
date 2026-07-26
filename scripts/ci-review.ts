import { execFileSync } from "node:child_process";
import { gateway, generateText } from "ai";
import { z } from "zod";

// ---------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------

/**
 * Walk a unified diff and return, per file, the set of new-file line numbers
 * that are added or changed (lines prefixed with `+`). These are the only valid
 * anchor points for a GitHub PR review comment.
 */
export function parseDiffAddedLines(diff: string): Map<string, Set<number>> {
  const result = new Map<string, Set<number>>();
  let currentLines: Set<number> | null = null;
  let newLineCounter = 0;

  const lines = diff.split("\n");
  for (const line of lines) {
    // Hunk header: @@ -a,b +c,d @@
    const hunkMatch = line.match(/^@@\s+-(\d+),\d+\s+\+(\d+),\d+\s+@@/);
    if (hunkMatch) {
      newLineCounter = Number.parseInt(hunkMatch[2], 10);
      continue;
    }

    // File header for the new-file side
    const fileMatch = line.match(/^\+\+\+\s+b\/(.+)$/);
    if (fileMatch) {
      const path = fileMatch[1];
      currentLines = result.get(path) ?? new Set();
      result.set(path, currentLines);
      continue;
    }

    // Index / diff --git / --- lines - skip
    if (
      line.startsWith("--- ") ||
      line.startsWith("diff --git ") ||
      line.startsWith("index ")
    ) {
      continue;
    }

    // Hunk body processing
    if (currentLines) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        // Added line
        currentLines.add(newLineCounter);
        newLineCounter++;
      } else if (line.startsWith(" ")) {
        // Context line - advances the counter
        newLineCounter++;
      }
      // Lines starting with `-` do not advance the counter
    }
  }

  return result;
}

/**
 * Extract JSON from model output, stripping a single markdown code fence
 * (```json or bare ```) if present.
 */
export function extractReviewJson(modelOutput: string): unknown {
  const trimmed = modelOutput.trim();

  // Try to strip a leading/trailing markdown code fence
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenceMatch) {
    return JSON.parse(fenceMatch[1].trim());
  }

  return JSON.parse(trimmed);
}

// ---------------------------------------------------------------
// Review schema (zod)
// ---------------------------------------------------------------

const commentSchema = z.object({
  path: z.string(),
  line: z.number(),
  side: z.literal("RIGHT"),
  body: z.string(),
});

const reviewSchema = z.object({
  event: z.literal("COMMENT"),
  body: z.string(),
  comments: z.array(commentSchema),
});


// ---------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------

/**
 * Build the review prompt from the diff and the two-lens instructions.
 *
 * Hand-synced with `agent/subagents/reviewer/instructions.md`'s lenses - see
 * agent/README.md's "Review triggering moved to CI (HAR-63)" section for why.
 */
function buildPrompt(diff: string): string {
  return `You ponytail-review exactly one pull request per invocation for ts-rogue, a TypeScript terminal dungeon crawler.

# The job

1. Apply two lenses, in one pass, over every changed file.

   LENS 1 - over-engineering (every changed file):
   Unnecessary complexity: reinvented standard library, unneeded dependencies, speculative abstractions, dead flexibility, boilerplate, one-implementation interfaces, config for values that never change.
   Tags: \`delete:\` / \`stdlib:\` / \`native:\` / \`yagni:\` / \`shrink:\`

   LENS 2 - conventions & stack idioms (per file, only where it fits):
   - Repo conventions: flag violations of the project's OWN conventions - no em dashes, extensionless relative imports (never a \`.js\` specifier), \`src/engine\` kept independent from \`src/ui\`, \`GameState\` JSON-serializable, reducers pure and side-effect-free on rejected actions, every random outcome routed through seeded RNG. Do NOT flag anything \`biome\` or \`tsgo\` already catch - CI owns formatting and type errors. Tag: \`convention:\`
   - TypeScript (\`.ts\`/\`.tsx\`): \`any\` where \`unknown\` fits, missing \`import type\`, stringly-typed code that should be a union, non-null \`!\` hiding a real nullable. Tag: \`ts:\`

   Out of scope: correctness, security, and logic bugs - a separate reviewer and a human own those. Report only; apply no fixes.

2. Output ONLY a JSON object (no prose, no markdown fence) of the exact shape:
   \`{"event":"COMMENT","body":"<summary>","comments":[{"path":"<file>","line":<line>,"side":"RIGHT","body":"<tag> <what>. <fix>."}]}\`

   \`<summary>\` is exactly one line: \`net: -<N> lines, <M> convention fixes.\` when findings exist, or \`net: clean. Ship.\` with an empty \`comments\` array when none do.

   Every comment's \`line\` MUST be a line the diff shows as added/changed (prefixed with \`+\`). A comment anchored to any other line makes GitHub reject the entire review.

# Diff to review

\`\`\`
${diff}
\`\`\``;
}

// ---------------------------------------------------------------
// Main execution
// ---------------------------------------------------------------

async function main() {
  const {
    GITHUB_TOKEN,
    AI_GATEWAY_API_KEY,
    PR_NUMBER,
    BASE_REF,
    HEAD_SHA,
    BEFORE_SHA,
    GITHUB_REPOSITORY,
  } = process.env;

  // Soft-skip when the gateway key is not configured
  if (!AI_GATEWAY_API_KEY) {
    console.log(
      "AI_GATEWAY_API_KEY not set - configure the repo secret to enable automated review. Skipping.",
    );
    process.exit(0);
  }

  // Hard-fail on missing required env vars (these should always be present
  // when running inside the Actions workflow).
  if (!GITHUB_TOKEN) throw new Error("GITHUB_TOKEN is required");
  if (!PR_NUMBER) throw new Error("PR_NUMBER is required");
  if (!BASE_REF) throw new Error("BASE_REF is required");
  if (!HEAD_SHA) throw new Error("HEAD_SHA is required");
  if (!GITHUB_REPOSITORY) throw new Error("GITHUB_REPOSITORY is required");

  // Fetch the base branch so we can diff against it
  execFileSync("git", ["fetch", "origin", BASE_REF], { stdio: "pipe" });

  // Compute the diff
  let diff: string;
  const fullDiffArgs = [
    "diff",
    `origin/${BASE_REF}...${HEAD_SHA}`,
  ];

  if (BEFORE_SHA) {
    // Re-review - scope to only what changed since the last push
    const scopedArgs = ["diff", `${BEFORE_SHA}...${HEAD_SHA}`];
    try {
      diff = execFileSync("git", scopedArgs, {
        encoding: "utf-8",
        stdio: "pipe",
      });
    } catch {
      // Force-push or rebase made BEFORE_SHA unreachable - fall back to full diff
      diff = execFileSync("git", fullDiffArgs, {
        encoding: "utf-8",
        stdio: "pipe",
      });
    }
  } else {
    diff = execFileSync("git", fullDiffArgs, {
      encoding: "utf-8",
      stdio: "pipe",
    });
  }

  if (!diff.trim()) {
    console.log("No diff. Skipping.");
    process.exit(0);
  }

  // Build the prompt and call the model
  const prompt = buildPrompt(diff);
  const { text: modelOutput } = await generateText({
    model: gateway("anthropic/claude-sonnet-5"),
    prompt,
  });

  // Parse & validate the model output
  const raw = extractReviewJson(modelOutput);
  const parsed = reviewSchema.parse(raw);

  // Filter comments to only valid lines from the diff
  const validLines = parseDiffAddedLines(diff);
  const filteredComments = parsed.comments.filter((c) => {
    const fileLines = validLines.get(c.path);
    if (!fileLines?.has(c.line)) {
      console.warn(
        `[ci-review] Dropping comment for ${c.path}:${c.line} - not in diff added lines`,
      );
      return false;
    }
    return true;
  });

  // POST the review to the GitHub API
  const url = `https://api.github.com/repos/${GITHUB_REPOSITORY}/pulls/${PR_NUMBER}/reviews`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      event: "COMMENT",
      body: parsed.body,
      comments: filteredComments,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `GitHub API error (${response.status}): ${body}`,
    );
  }
}

// Guard: only run when this module is executed directly, not when imported
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
