import { getToken } from "@vercel/connect";
import { defineSandbox, type SandboxNetworkPolicy, type SandboxSession } from "eve/sandbox";
import { vercel } from "eve/sandbox/vercel";

// GitHub App installation tokens live ~1h; refresh the injected header well
// before that so a session that outlasts one token can still push.
const TOKEN_REFRESH_MS = 45 * 60 * 1000;

async function githubNetworkPolicy(): Promise<SandboxNetworkPolicy> {
  const token = await getToken("github/ts-rogue-eve-github", {
    subject: { type: "app" },
    scopes: ["*"],
  });
  const authorization = `Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
  return {
    allow: {
      "github.com": [{ transform: [{ headers: { authorization } }] }],
      "*.github.com": [{ transform: [{ headers: { authorization } }] }],
      "*": [],
    },
  };
}

// The auth header is frozen into the firewall policy at session start, so a
// static token expires mid-session. Re-mint it on an interval via
// setNetworkPolicy. There is no session-end hook, so the chain self-terminates
// when setNetworkPolicy throws (sandbox torn down) rather than leaking a timer.
export function keepTokenFresh(
  sandbox: Pick<SandboxSession, "setNetworkPolicy">,
  mintPolicy: () => Promise<SandboxNetworkPolicy> = githubNetworkPolicy,
  intervalMs: number = TOKEN_REFRESH_MS,
) {
  return setTimeout(async () => {
    try {
      await sandbox.setNetworkPolicy(await mintPolicy());
    } catch {
      return;
    }
    keepTokenFresh(sandbox, mintPolicy, intervalMs);
  }, intervalMs);
}

export default defineSandbox({
  backend: vercel(),
  async bootstrap({ use }) {
    const sandbox = await use({
      networkPolicy: await githubNetworkPolicy(),
    });
    const setup = await sandbox.run({
      command:
        "git config --global --add safe.directory /workspace && git clone https://github.com/zico-io/ts-rogue.git . && corepack pnpm install --frozen-lockfile",
    });
    if (setup.exitCode !== 0) throw new Error(setup.stderr || "Sandbox pre-warming failed");
  },
  async onSession({ use }) {
    const sandbox = await use({
      networkPolicy: await githubNetworkPolicy(),
    });
    keepTokenFresh(sandbox);
  },
});
