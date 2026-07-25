import { connectGitHubCredentials } from "@vercel/connect/eve";
import {
  defaultGitHubAuth,
  type GitHubChannelEvents,
  type GitHubComment,
  type GitHubEventContext,
  type GitHubInboundContext,
  type GitHubPullRequestEvent,
  githubChannel,
} from "eve/channels/github";
import type { SessionContext } from "eve/tools";

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
  // Set only for a re-review triggered by a push to an already-reviewed PR
  // (`synchronize`): the head sha the *previous* review covered, taken from
  // the webhook payload's own `before` field. Scoping the diff to just what
  // changed since then avoids re-flagging - and re-posting findings on -
  // lines a prior review already passed judgment on.
  reReviewSinceSha: string | null,
) => {
  const fetchCmd = reReviewSinceSha
    ? `git fetch origin ${reReviewSinceSha} ${headRef}`
    : `git fetch origin ${baseRef} ${headRef}`;
  const diffCmd = reReviewSinceSha
    ? `git diff ${reReviewSinceSha}...origin/${headRef}`
    : `git diff origin/${baseRef}...origin/${headRef}`;
  const scopeNote = reReviewSinceSha
    ? `\nThis is a re-review triggered by a new push, not the PR's first review. Review ONLY the diff introduced since the last review (${reReviewSinceSha} to the new head) - do not re-review or re-report on parts of the PR a prior review already covered. If fetching ${reReviewSinceSha} fails (a rebase or force-push can make an old commit unreachable), fall back to the full origin/${baseRef}...origin/${headRef} diff instead.\n`
    : "";
  return `Ponytail-review pull request #${prNumber} in zico-io/ts-rogue. This is a review-only turn (see "PR review turns"): review and post, nothing else.
${scopeNote}
Get the diff (the working tree is on main; fetch the PR's refs):
  ${fetchCmd}
  ${diffCmd}
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
<summary> is exactly one line: \`net: -<N> lines, <M> convention fixes.\` when you found something, or \`net: clean. Ship.\` when you did not (post it with an empty comments array). Do not post any other comment, summary, or confirmation - the review posted via curl above is the only reply this turn produces. Then stop.`;
};

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

// Marks a dispatched turn's auth as "review-only" (HAR-24): ponytail's
// auto-review turn already posts its findings as a native PR review via the
// curl call in ponytailReviewContext above, so the agent's own trailing
// assistant text for that turn is a second, redundant top-level comment
// ("Review posted: ...") duplicating what the review UI already shows. The
// flag rides in the dispatch auth's attributes (the one piece of dispatch-time
// data a later `message.completed` handler can still read, via
// `ctx.session.auth.initiator`) so that handler can skip posting it.
export const REVIEW_ONLY_TURN_ATTRIBUTE = "tsRogueReviewOnlyTurn";

const reviewOnlyAuth = (ctx: GitHubInboundContext) => {
  const auth = defaultGitHubAuth(ctx);
  return {
    ...auth,
    attributes: { ...auth.attributes, [REVIEW_ONLY_TURN_ATTRIBUTE]: "true" },
  };
};

const isReviewOnlyTurn = (ctx: SessionContext): boolean =>
  ctx.session.auth.initiator?.attributes[REVIEW_ONLY_TURN_ATTRIBUTE] === "true";

// GitHub's own comment-body size cap, mirrored here because eve's internal
// `splitGitHubCommentBody` isn't part of the public `eve/channels/github`
// API surface (only `defaultGitHubAuth` is exported from that module - see
// the comment on `isBotMentioned` above for how that was confirmed).
// ponytail: this is a naive fixed-length split, not the paragraph-aware
// chunking eve's internal helper does. Ceiling: a reply could break
// mid-sentence at a chunk boundary. Upgrade path: ask eve to publicize its
// splitter, or vendor its exact rules, if a reply this large ever ships in
// practice - ordinary agent replies stay well under this limit.
const GITHUB_COMMENT_BODY_MAX_LENGTH = 65536;

const splitCommentBody = (body: string): readonly string[] => {
  const chunks: string[] = [];
  for (let i = 0; i < body.length; i += GITHUB_COMMENT_BODY_MAX_LENGTH) {
    chunks.push(body.slice(i, i + GITHUB_COMMENT_BODY_MAX_LENGTH));
  }
  return chunks;
};

// Posts a completed assistant message as a GitHub comment, mirroring eve's
// built-in `message.completed` handler (`postCommentChunks` in
// `defaults.js`), except it skips the post entirely for a review-only turn
// (see `isReviewOnlyTurn` above) to eliminate the duplicate comment from
// HAR-24. Declaring this handler in `events` replaces eve's built-in for this
// key rather than layering on top of it, so the non-review path re-implements
// the same chunk-and-post behavior the default provided.
export const onMessageCompleted = async (
  data: { finishReason?: string; message: string | null },
  channel: GitHubEventContext,
  ctx: SessionContext,
): Promise<void> => {
  if (data.finishReason === "tool-calls" || !data.message) return;
  if (isReviewOnlyTurn(ctx)) return;
  for (const chunk of splitCommentBody(data.message)) {
    await channel.thread.post(chunk);
  }
};

// --- Connection authorization ----------------------------------------------
// Port of the Linear channel's authorization surfacing (HAR-31) to this
// channel (HAR-33): eve's GitHub defaults implement no `authorization.*`
// handlers either, so when a user-scoped `connect(...)` connection needed
// OAuth on a GitHub-dispatched turn (a merge wake, a review-feedback turn),
// eve parked the turn and the event was dropped - no PR comment, no error,
// a silently stalled turn. GitHub has no native auth signal like Linear's
// "Link account" elicitation, so the challenge posts as a plain thread
// comment carrying the authorization link. This is visibility, not the
// merge-wake fix itself - that is the Linear MCP connection going app-scoped
// in `connections/linear.ts`.

// Mirror of the Linear channel's fallback: title-case the connection scope
// name ("linear" -> "Linear") when the challenge carries no displayName.
// Duplicated (2 lines) rather than imported so this file stays disjoint from
// channels/linear.ts.
const connectionDisplayName = (name: string): string =>
  name.replace(/[-_/]+/gu, " ").replace(/\b\p{L}/gu, (c) => c.toUpperCase());

export const onAuthorizationRequired: NonNullable<
  GitHubChannelEvents["authorization.required"]
> = async (data, channel) => {
  const challenge = data.authorization;
  const displayName =
    challenge?.displayName ?? connectionDisplayName(data.name);
  await channel.thread.post(
    [
      `I need ${displayName} connected before I can continue.`,
      ...(challenge?.instructions ? ["", challenge.instructions] : []),
      ...(challenge?.userCode ? ["", `Code: \`${challenge.userCode}\``] : []),
      ...(challenge?.url
        ? ["", `[Authorize ${displayName}](${challenge.url})`]
        : []),
    ].join("\n"),
  );
};

export const onAuthorizationCompleted: NonNullable<
  GitHubChannelEvents["authorization.completed"]
> = async (data, channel) => {
  const displayName =
    data.authorization?.displayName ?? connectionDisplayName(data.name);
  if (data.outcome === "authorized") {
    await channel.thread.post(`Connected to ${displayName}. Resuming.`);
    return;
  }
  const outcome = data.outcome === "timed-out" ? "timed out" : data.outcome;
  await channel.thread.post(
    `Authorization for ${displayName} ${outcome}${data.reason ? `: ${data.reason}` : "."}`,
  );
};

export const onPullRequest = (
  context: GitHubInboundContext,
  pullRequest: GitHubPullRequestEvent,
) => {
  if (isMainMerge(pullRequest)) {
    const ref = linearRefFromPullRequest(pullRequest);
    return {
      auth: defaultGitHubAuth(context),
      context: ref
        ? [MAIN_MERGE_SYNCED, ralphAdvanceContext(ref)]
        : [MAIN_MERGE_SYNCED],
    };
  }
  // Auto ponytail-review on a newly opened / newly ready pull request, and
  // again on every push to it (`synchronize`) - the latter is what turns a
  // fix-and-resolve into a fresh re-review (HAR-24) with no extra
  // resolution-tracking: pushing a fix commit, whether from a human or from
  // this agent's own "PR review-feedback turns" handling, already fires
  // this same GitHub event.
  if (
    pullRequest.action === "opened" ||
    pullRequest.action === "ready_for_review" ||
    pullRequest.action === "synchronize"
  ) {
    const raw = pullRequest.raw as {
      draft?: boolean;
      head?: { ref?: string };
      base?: { ref?: string };
      before?: string;
    };
    // Event-time draft flag, not a live fetch: a PR opened as a draft then
    // marked ready fires both events; gating on the payload's own draft flag
    // reviews exactly once (a ready_for_review payload is never a draft).
    if (raw.draft === true) return null;
    const head = raw.head?.ref;
    if (!head) return null;
    const base = raw.base?.ref ?? "main";
    // `before` is only meaningful on `synchronize` (the sha the previous
    // review saw); GitHub also omits it once in a while (e.g. a synthetic
    // replay), in which case ponytailReviewContext falls back to the full
    // base...head diff.
    const reReviewSinceSha =
      pullRequest.action === "synchronize" && raw.before ? raw.before : null;
    return {
      auth: reviewOnlyAuth(context),
      context: [
        ponytailReviewContext(
          pullRequest.pullRequestNumber,
          base,
          head,
          reReviewSinceSha,
        ),
      ],
    };
  }
  return null;
};

export default githubChannel({
  credentials: connectGitHubCredentials("github/ts-rogue-eve-github"),
  events: {
    // onSession already synced main; skip the channel's default PR-head checkout.
    "turn.started": () => {},
    "message.completed": onMessageCompleted,
    "authorization.required": onAuthorizationRequired,
    "authorization.completed": onAuthorizationCompleted,
  },
  onComment,
  onPullRequest,
});
