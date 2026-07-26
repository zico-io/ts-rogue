import { execFileSync } from "node:child_process";
import { gateway, generateText } from "ai";
import { z } from "zod";

/** Maps each changed file to the new-side line numbers valid for review comments. */
export function parseDiffAddedLines(diff: string): Map<string, Set<number>> {
  const result = new Map<string, Set<number>>();
  let currentLines: Set<number> | null = null;
  let newLineCounter = 0;

  const lines = diff.split("\n");
  for (const line of lines) {
    const hunkMatch = line.match(/^@@\s+-(\d+),\d+\s+\+(\d+),\d+\s+@@/);
    if (hunkMatch) {
      newLineCounter = Number.parseInt(hunkMatch[2], 10);
      continue;
    }

    const fileMatch = line.match(/^\+\+\+\s+b\/(.+)$/);
    if (fileMatch) {
      const path = fileMatch[1];
      currentLines = result.get(path) ?? new Set();
      result.set(path, currentLines);
      continue;
    }

    if (
      line.startsWith("--- ") ||
      line.startsWith("diff --git ") ||
      line.startsWith("index ")
    ) {
      continue;
    }

    if (currentLines) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        currentLines.add(newLineCounter);
        newLineCounter++;
      } else if (line.startsWith(" ")) {
        newLineCounter++;
      }
    }
  }

  return result;
}

/** Parses JSON with or without one surrounding Markdown code fence. */
export function extractReviewJson(modelOutput: string): unknown {
  const trimmed = modelOutput.trim();

  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenceMatch) {
    return JSON.parse(fenceMatch[1].trim());
  }

  return JSON.parse(trimmed);
}

const commentSchema = z.object({
  path: z.string(),
  line: z.number(),
  side: z.unknown().optional().transform(() => "RIGHT" as const),
  body: z.string(),
});

const reviewSchema = z.object({
  event: z.literal("COMMENT"),
  body: z.string(),
  comments: z.array(commentSchema),
});

export function parseReview(modelOutput: string) {
  return reviewSchema.parse(extractReviewJson(modelOutput));
}

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

   LENS 3 - Agent Interaction Guidelines (only when the diff touches \`agent/\`, this repo's own eve harness): flag changes that erode Linear's six AIG principles (https://linear.app/developers/aig) - agent disclosure, native platform actions, immediate feedback, transparent state, immediate disengagement, or human accountability. Tag: \`aig:\`

   Out of scope: correctness, security, and logic bugs. Report only; apply no fixes.

2. Output ONLY a JSON object (no prose, no markdown fence) of the exact shape:
   \`{"event":"COMMENT","body":"<summary>","comments":[{"path":"<file>","line":<line>,"side":"RIGHT","body":"<tag> <what>. <fix>."}]}\`

   \`<summary>\` is exactly one line: \`net: -<N> lines, <M> convention fixes.\` when findings exist, or \`net: clean. Ship.\` with an empty \`comments\` array when none do.

   Every comment's \`line\` MUST be a line the diff shows as added/changed (prefixed with \`+\`). A comment anchored to any other line makes GitHub reject the entire review.

# Diff to review

\`\`\`
${diff}
\`\`\``;
}

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

  if (!AI_GATEWAY_API_KEY) {
    console.log(
      "AI_GATEWAY_API_KEY not set - configure the repo secret to enable automated review. Skipping.",
    );
    process.exit(0);
  }

  if (!GITHUB_TOKEN) throw new Error("GITHUB_TOKEN is required");
  if (!PR_NUMBER) throw new Error("PR_NUMBER is required");
  if (!BASE_REF) throw new Error("BASE_REF is required");
  if (!HEAD_SHA) throw new Error("HEAD_SHA is required");
  if (!GITHUB_REPOSITORY) throw new Error("GITHUB_REPOSITORY is required");

  execFileSync("git", ["fetch", "origin", BASE_REF], { stdio: "pipe" });

  let diff: string;
  const fullDiffArgs = ["diff", `origin/${BASE_REF}...${HEAD_SHA}`];

  if (BEFORE_SHA) {
    const scopedArgs = ["diff", `${BEFORE_SHA}...${HEAD_SHA}`];
    try {
      diff = execFileSync("git", scopedArgs, {
        encoding: "utf-8",
        stdio: "pipe",
      });
    } catch {
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

  const prompt = buildPrompt(diff);
  const { text: modelOutput } = await generateText({
    model: gateway("anthropic/claude-sonnet-5"),
    prompt,
  });

  const parsed = parseReview(modelOutput);

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
    throw new Error(`GitHub API error (${response.status}): ${body}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
