import { connectGitHubCredentials } from "@vercel/connect/eve";
import {
  defaultGitHubAuth,
  type GitHubComment,
  type GitHubInboundContext,
  type GitHubPullRequestEvent,
  githubChannel,
} from "eve/channels/github";

export const isMainMerge = (pullRequest: GitHubPullRequestEvent) => {
  const base = pullRequest.raw.base;
  return (
    pullRequest.action === "closed" &&
    pullRequest.raw.merged === true &&
    typeof base === "object" &&
    base !== null &&
    "ref" in base &&
    base.ref === "main"
  );
};

// Every Linear team key whose issues this agent drives. An explicit list, not
// a generic [A-Z]+-\d+ pattern: PR bodies are scanned too, and a generic match
// would false-positive on tokens like SHA-256 or ISO-8601.
export const LINEAR_TEAM_KEYS = ["ROG", "ENG", "HAR", "WEB"] as const;

const LINEAR_REF_PATTERN = new RegExp(
  `\\b(?:${LINEAR_TEAM_KEYS.join("|")})-\\d+\\b`,
  "i",
);

// The Linear issue a merged PR closes, taken from the branch, title, or body.
// ralph mode uses it to advance the enclosing issue group; standalone PRs
// return null and skip the advance context.
export const linearRefFromPullRequest = (
  pullRequest: GitHubPullRequestEvent,
): string | null => {
  const { head, title, body } = pullRequest.raw as {
    head?: { ref?: unknown };
    title?: unknown;
    body?: unknown;
  };
  const fields = [head?.ref, title, body];
  for (const field of fields) {
    if (typeof field !== "string") continue;
    const match = field.match(LINEAR_REF_PATTERN);
    if (match) return match[0].toUpperCase();
  }
  return null;
};

const MAIN_MERGE_SYNCED =
  "A pull request was merged into main. The sandbox checkout has already updated automatically; no manual repository sync is needed.";

const ralphAdvanceContext = (ref: string) =>
  `The merged pull request closes Linear issue ${ref}. If ${ref} is a sub-issue of a parent issue you are ralphing (an in-progress issue group), advance that group per the "Issue groups" instructions: confirm ${ref} is Done, then hand off every newly ready sub-issue to the agent via Linear. If ${ref} is a standalone issue, no further action is needed.`;

// The two-lens ponytail review, inlined as a review turn's context. Ported from
// bask/fleet's PONYTAIL_REVIEW_PROMPT and retargeted to ts-rogue's contract and
// its native GitHub-over-curl posting (gh is not installed; auth is injected at
// the network boundary). Findings must anchor to added/changed diff lines or
// GitHub rejects the whole review.
const ponytailReviewContext = (
  prNumber: number,
  baseRef: string,
  headRef: string,
) =>
  `Ponytail-review pull request #${prNumber} in zico-io/ts-rogue. This is a review-only turn (see "PR review turns"): review and post, nothing else.

Get the diff (the working tree is on main; fetch the PR's refs):
  git fetch origin ${baseRef} ${headRef}
  git diff origin/${baseRef}...origin/${headRef}
Read a changed file's full context with \`git show origin/${headRef}:<path>\` when a lens needs it.

Apply two lenses in one pass.

LENS 1 - over-engineering (every changed file):
Unnecessary complexity: reinvented standard library, unneeded dependencies, speculative abstractions, dead flexibility, boilerplate, one-implementation interfaces, config for values that never change.
Tags: delete: / stdlib: / native: / yagni: / shrink:

LENS 2 - conventions & stack idioms (per file, only where it fits):
- Repo conventions: skim AGENTS.md, biome.json, tsconfig.json, then flag violations of the project's OWN conventions - no em dashes, extensionless relative imports (never a .js specifier), src/engine kept independent from src/ui, GameState JSON-serializable, reducers pure and side-effect-free on rejected actions, every random outcome routed through seeded RNG. Do NOT flag anything \`biome\` or \`tsgo\` already catch - CI owns formatting and type errors. Tag: convention:
- TypeScript (.ts/.tsx): \`any\` where \`unknown\` fits, missing \`import type\`, stringly-typed code that should be a union, non-null \`!\` hiding a real nullable. Tag: ts:

Out of scope: correctness, security, and logic bugs - a separate reviewer and a human own those. Report only; apply no fixes.

Post the findings as ONE pull-request review via curl. Each finding's line MUST be a line the diff ADDS or CHANGES (a line the diff shows with a leading +); a comment on any other line makes GitHub reject the entire review. Auth is injected at the network boundary - do NOT add an Authorization header. Write the body to a file (to avoid shell-quoting issues) and post it exactly once:
  cat > /tmp/review.json <<'JSON'
  {"event":"COMMENT","body":"<summary>","comments":[{"path":"<file>","line":<line>,"side":"RIGHT","body":"<tag> <what>. <fix>."}]}
  JSON
  curl -sS -X POST -H "Accept: application/vnd.github+json" https://api.github.com/repos/zico-io/ts-rogue/pulls/${prNumber}/reviews -d @/tmp/review.json
<summary> is exactly one line: \`net: -<N> lines, <M> convention fixes.\` when you found something, or \`net: clean. Ship.\` when you did not (post it with an empty comments array). Then stop.`;

// Context for a turn woken by review feedback landing on a pull request (see
// "PR review-feedback turns" in instructions.md for the full contract). Kept
// short and pointed at that section rather than repeated here, matching how
// ponytailReviewContext above points back at "PR review turns" instead of
// inlining its own procedure.
const REVIEW_FEEDBACK_CONTEXT =
  'Reviewer feedback landed on this pull request (see the comment above). This is a PR review-feedback turn (see "PR review-feedback turns" in the contract): validate it, then either fix the code or reply - nothing else.';

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

// Mirrors the @mention check eve's own built-in `onComment` gate uses
// (`extractGitHubCommentTrigger` in `dist/.../channels/github/inbound.js`),
// reimplemented here because supplying `onComment` below replaces that
// built-in gate entirely rather than layering on top of it (see eve's github
// channel docs), and `eve/channels/github`'s public barrel exports only
// `defaultGitHubAuth` from that module - not the mention helper itself
// (confirmed against the package's own `exports` map: `inbound`/`defaults`
// have no public subpath, only the top-level `./channels/github` entry
// point). The bot-authored/self-comment loop guard needs no reimplementation
// here - eve applies that before ever calling `onComment`.
export const isBotMentioned = (
  body: string,
  botName: string | undefined,
): boolean => {
  const name = botName?.trim();
  if (!name) return false;
  return new RegExp(`@${escapeRegExp(name)}(?=$|[^A-Za-z0-9_-])`, "iu").test(
    body,
  );
};

// A pull-request review comment is a finding - actionable feedback tied to a
// code location - only the first time it appears in its thread. GitHub fires
// the same `pull_request_review_comment` webhook for every later reply in
// that thread too (its raw payload carries `in_reply_to_id` once it is a
// reply; eve's normalized `GitHubComment` drops that field, so it is read
// off `comment.raw` directly, the same way `onPullRequest` above reads
// `pullRequest.raw` for fields the normalized event omits). Replies are
// conversation about a finding already surfaced, not a new one, so they
// should not spin up another turn.
const isNewReviewFinding = (comment: GitHubComment): boolean => {
  const raw = comment.raw as { in_reply_to_id?: unknown };
  return raw.in_reply_to_id === undefined || raw.in_reply_to_id === null;
};

export const onComment = (
  ctx: GitHubInboundContext,
  comment: GitHubComment,
) => {
  // Inline pull-request review comments - the shape both a human review and
  // ponytail's own auto-review (above) post - wake the agent unconditionally
  // when they are a new finding: feedback left during a review is a request
  // to act on, not a chat message that needs an explicit @mention to be
  // seen. A reply within an already-open review thread is not a new finding
  // and is skipped. Ordinary issue/PR discussion comments keep requiring a
  // mention, matching eve's built-in behavior.
  if (ctx.conversation.kind === "review_thread") {
    return isNewReviewFinding(comment)
      ? {
          auth: defaultGitHubAuth(ctx),
          context: [REVIEW_FEEDBACK_CONTEXT],
        }
      : null;
  }
  return isBotMentioned(comment.body, process.env.GITHUB_APP_SLUG)
    ? { auth: defaultGitHubAuth(ctx) }
    : null;
};

export default githubChannel({
  credentials: connectGitHubCredentials("github/ts-rogue-eve-github"),
  // onSession already synced main; skip the channel's default PR-head checkout.
  events: { "turn.started": () => {} },
  onComment,
  onPullRequest: (context, pullRequest) => {
    if (isMainMerge(pullRequest)) {
      const ref = linearRefFromPullRequest(pullRequest);
      return {
        auth: defaultGitHubAuth(context),
        context: ref
          ? [MAIN_MERGE_SYNCED, ralphAdvanceContext(ref)]
          : [MAIN_MERGE_SYNCED],
      };
    }
    // Auto ponytail-review on newly opened / newly ready pull requests.
    if (
      pullRequest.action === "opened" ||
      pullRequest.action === "ready_for_review"
    ) {
      const raw = pullRequest.raw as {
        draft?: boolean;
        head?: { ref?: string };
        base?: { ref?: string };
      };
      // Event-time draft flag, not a live fetch: a PR opened as a draft then
      // marked ready fires both events; gating on the payload's own draft flag
      // reviews exactly once (a ready_for_review payload is never a draft).
      if (raw.draft === true) return null;
      const head = raw.head?.ref;
      if (!head) return null;
      const base = raw.base?.ref ?? "main";
      return {
        auth: defaultGitHubAuth(context),
        context: [
          ponytailReviewContext(pullRequest.pullRequestNumber, base, head),
        ],
      };
    }
    return null;
  },
});
