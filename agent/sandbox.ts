import { defineSandbox, type SandboxNetworkPolicy } from "eve/sandbox";
import { vercel } from "eve/sandbox/vercel";

// forwardURL brokering: the firewall forwards brokered egress to our proxy
// (agent/proxy.ts), which mints a fresh token per request - no secret in the
// sandbox, no token frozen into the policy to refresh.
// https://vercel.com/docs/sandbox/concepts/firewall#credentials-brokering
function sandboxProxyUrl(): string | undefined {
  if (process.env.SANDBOX_PROXY_URL) return process.env.SANDBOX_PROXY_URL;
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return host ? `https://${host}/api/proxy` : undefined;
}

// No proxy (e.g. local dev): open egress, no brokering. Authenticated git won't
// work, but it's a dev-only gap, not a hang.
const OPEN_NETWORK_POLICY: SandboxNetworkPolicy = { allow: { "*": [] } };

// Private repo, so all of github.com goes through the proxy. Add brokered hosts
// here as they're added to agent/proxy.ts; `"*": []` keeps other egress direct.
export function githubNetworkPolicy(
  forwardURL = sandboxProxyUrl(),
): SandboxNetworkPolicy {
  if (!forwardURL) return OPEN_NETWORK_POLICY;
  return {
    allow: {
      "github.com": [{ forwardURL }],
      "*.github.com": [{ forwardURL }],
      "*": [],
    },
  };
}

export default defineSandbox({
  backend: vercel(),
  revalidationKey: () => process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
  async bootstrap({ use }) {
    const sandbox = await use({ networkPolicy: githubNetworkPolicy() });
    const setup = await sandbox.run({
      command:
        // tmux backs the play harness (scripts/play.sh) so the agent can drive
        // the real game in-sandbox; `|| true` keeps a locked-down image from
        // failing the whole pre-warm if the package install is unavailable.
        "(sudo apt-get update && sudo apt-get install -y tmux || true) && git config --global --add safe.directory /workspace && git clone https://github.com/zico-io/ts-rogue.git . && corepack pnpm install --frozen-lockfile",
    });
    if (setup.exitCode !== 0)
      throw new Error(setup.stderr || "Sandbox pre-warming failed");
  },
  async onSession({ use }) {
    const sandbox = await use({ networkPolicy: githubNetworkPolicy() });
    const sync = await sandbox.run({
      command:
        "git fetch --depth 1 origin main && git checkout -B main FETCH_HEAD",
    });
    if (sync.exitCode !== 0)
      throw new Error(sync.stderr || "Sandbox repository sync failed");
  },
});
