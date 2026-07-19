import { getToken } from "@vercel/connect";
import { defineSandbox } from "eve/sandbox";
import { vercel } from "eve/sandbox/vercel";

async function githubNetworkPolicy() {
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
    await use({
      networkPolicy: await githubNetworkPolicy(),
    });
  },
});
