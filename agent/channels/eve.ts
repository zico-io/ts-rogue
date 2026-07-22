import { eveChannel } from "eve/channels/eve";
import { localDev, oidc, placeholderAuth, vercelOidc } from "eve/channels/auth";

export default eveChannel({
  auth: [
    // Lets the eve TUI and your Vercel deployments reach the deployed agent.
    vercelOidc(),
    // GitHub Actions OIDC, so the scheduled ralph eval authenticates with a
    // short-lived per-run token instead of a stored bearer. Locked to this
    // repo and the eval's audience; see .github/workflows/ralph-eval.yml.
    oidc({
      issuer: "https://token.actions.githubusercontent.com",
      audiences: ["eve-ralph-eval"],
      claims: { repository: ["zico-io/ts-rogue"] },
    }),
    // Open on localhost for `eve dev` and the REPL; ignored in production.
    localDev(),
    // This placeholder will not allow browser requests in production.
    // Replace it with your app's auth provider, like Auth.js or Clerk,
    // or use none() for a public demo.
    placeholderAuth(),
  ],
});
