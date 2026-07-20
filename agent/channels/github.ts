import { connectGitHubCredentials } from "@vercel/connect/eve";
import {
  defaultGitHubAuth,
  githubChannel,
  type GitHubPullRequestEvent,
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

export default githubChannel({
  credentials: connectGitHubCredentials("github/ts-rogue-eve-github"),
  // onSession already synced main; skip the channel's default PR-head checkout.
  events: { "turn.started": () => {} },
  onPullRequest: (context, pullRequest) =>
    isMainMerge(pullRequest)
      ? {
          auth: defaultGitHubAuth(context),
          context: [
            "A pull request was merged into main. The sandbox checkout has already updated automatically; no manual repository sync is needed.",
          ],
        }
      : null,
});
