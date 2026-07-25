import { getToken } from "@vercel/connect";
import type { SandboxNetworkPolicy } from "eve/sandbox";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/connect", () => ({
  getToken: vi.fn(() => Promise.resolve("fresh-token")),
}));

import {
  AUTO_RECOVER_PUSH_COMMAND,
  buildBootstrapCommand,
  createSandboxRecipe,
  OPEN_NETWORK_POLICY,
} from "../agent/lib/sandbox";

// Minimal fake sandbox session recording every run()'d command instead of
// executing it, standing in for eve's real SandboxSession. Every run
// succeeds so onSession/bootstrap take their happy-path branches.
function fakeSandbox() {
  const commands: string[] = [];
  const sandbox = {
    run: vi.fn(async ({ command }: { command: string }) => {
      commands.push(command);
      return { exitCode: 0, stdout: "", stderr: "" };
    }),
    writeTextFile: vi.fn(async () => {}),
    setNetworkPolicy: vi.fn(async () => {}),
  };
  return { sandbox, commands };
}

// createSandboxRecipe composes bootstrap/onSession from the same building
// blocks src/sandbox-token-refresh.test.ts already exercises in isolation
// (buildBootstrapCommand, resolveStartupNetworkPolicy, keepTokenFresh, ...);
// these tests cover the composition itself - which gitAuth level wires which
// pieces together - since that's the behavior HAR-26 actually adds.
describe("createSandboxRecipe gitAuth levels", () => {
  beforeEach(() => {
    vi.mocked(getToken).mockClear();
  });

  it("'none' never authenticates the live session and skips push recovery", async () => {
    const { sandbox, commands } = fakeSandbox();
    const recipe = createSandboxRecipe({ gitAuth: "none" });
    let usedPolicy: SandboxNetworkPolicy | undefined;

    await recipe.onSession?.({
      ctx: {} as never,
      use: async (opts) => {
        usedPolicy = (
          opts as { networkPolicy?: SandboxNetworkPolicy } | undefined
        )?.networkPolicy;
        return sandbox as never;
      },
    });

    expect(usedPolicy).toEqual(OPEN_NETWORK_POLICY);
    expect(getToken).not.toHaveBeenCalled();
    expect(commands).not.toContain(AUTO_RECOVER_PUSH_COMMAND);
  });

  it("'read-only' authenticates the live session but skips stranded-push recovery", async () => {
    const { sandbox, commands } = fakeSandbox();
    const recipe = createSandboxRecipe({ gitAuth: "read-only" });

    await recipe.onSession?.({
      ctx: {} as never,
      use: async () => sandbox as never,
    });

    expect(getToken).toHaveBeenCalled();
    expect(commands).not.toContain(AUTO_RECOVER_PUSH_COMMAND);
  });

  it("'push-capable' authenticates and also runs stranded-push recovery", async () => {
    const { sandbox, commands } = fakeSandbox();
    const recipe = createSandboxRecipe({ gitAuth: "push-capable" });

    await recipe.onSession?.({
      ctx: {} as never,
      use: async () => sandbox as never,
    });

    expect(getToken).toHaveBeenCalled();
    expect(commands).toContain(AUTO_RECOVER_PUSH_COMMAND);
  });

  it("bootstrap forwards screenshotTooling to buildBootstrapCommand", async () => {
    const { sandbox, commands } = fakeSandbox();
    const recipe = createSandboxRecipe({
      gitAuth: "none",
      screenshotTooling: false,
    });

    await recipe.bootstrap?.({ use: async () => sandbox as never });

    expect(commands).toContain(
      buildBootstrapCommand({ screenshotTooling: false }),
    );
    expect(commands[0]).not.toContain("playwright install");
  });
});

describe("buildBootstrapCommand screenshotTooling toggle", () => {
  it("omits the Playwright chromium install when disabled", () => {
    const command = buildBootstrapCommand({ screenshotTooling: false });
    expect(command).not.toContain("playwright install");
    expect(command).not.toContain("chromium.launch()");
  });

  it("still installs the repo checkout and CLI toolchain when disabled", () => {
    const command = buildBootstrapCommand({ screenshotTooling: false });
    expect(command).toContain(
      "git clone https://github.com/zico-io/ts-rogue.git",
    );
    expect(command).toContain(
      "apt-get install -y tmux ripgrep fd-find bat eza gh",
    );
    expect(command).toContain("npm install -g @ast-grep/cli");
  });
});
