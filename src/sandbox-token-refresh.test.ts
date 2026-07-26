import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getToken } from "@vercel/connect";
import type { SandboxNetworkPolicy } from "eve/sandbox";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/connect", () => ({
  getToken: vi.fn(() => Promise.resolve("fresh-token")),
}));

import {
  AUTO_RECOVER_PUSH_COMMAND,
  buildBootstrapCommand,
  dependencyRevalidationKey,
  keepTokenFresh,
  MAX_MINT_FAILURES,
  MAX_SET_POLICY_FAILURES,
  mintFreshPolicy,
  resolveBootstrapNetworkPolicy,
  resolveStartupNetworkPolicy,
  WORKSPACE_GIT_CONFIG_ENV,
} from "../agent/sandbox/sandbox";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

describe("keepTokenFresh", () => {
  it("re-mints and re-applies the policy on each interval", async () => {
    vi.useFakeTimers();
    const applied: SandboxNetworkPolicy[] = [];
    const sandbox = {
      setNetworkPolicy: (policy: SandboxNetworkPolicy) => {
        applied.push(policy);
        return Promise.resolve();
      },
    };
    const minted: SandboxNetworkPolicy[] = [
      { allow: { a: [] } } as SandboxNetworkPolicy,
      { allow: { b: [] } } as SandboxNetworkPolicy,
    ];
    let n = 0;

    keepTokenFresh(sandbox, () => Promise.resolve(minted[n++]), 1000);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(applied).toEqual([minted[0], minted[1]]);
    vi.useRealTimers();
  });

  it("retries on a transient mint failure instead of stopping", async () => {
    vi.useFakeTimers();
    const applied: SandboxNetworkPolicy[] = [];
    const sandbox = {
      setNetworkPolicy: (policy: SandboxNetworkPolicy) => {
        applied.push(policy);
        return Promise.resolve();
      },
    };
    const good = { allow: { b: [] } } as SandboxNetworkPolicy;
    let call = 0;
    const mintPolicy = () => {
      call++;
      return call === 1
        ? Promise.reject(new Error("token service blip"))
        : Promise.resolve(good);
    };

    keepTokenFresh(sandbox, mintPolicy, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(applied).toEqual([good]);
    vi.useRealTimers();
  });

  it("retries fast after a mint failure, then settles to the slow refresh cadence", async () => {
    vi.useFakeTimers();
    const applied: SandboxNetworkPolicy[] = [];
    const sandbox = {
      setNetworkPolicy: (policy: SandboxNetworkPolicy) => {
        applied.push(policy);
        return Promise.resolve();
      },
    };
    const good = { allow: { b: [] } } as SandboxNetworkPolicy;
    let call = 0;
    const mintPolicy = () => {
      call++;
      return call === 1
        ? Promise.reject(new Error("token service down"))
        : Promise.resolve(good);
    };

    keepTokenFresh(sandbox, mintPolicy, {
      refreshMs: 10000,
      retryMs: 1000,
      initialMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(applied).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(applied).toEqual([good]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(applied).toEqual([good]);
    await vi.advanceTimersByTimeAsync(9000);
    expect(applied).toEqual([good, good]);
    vi.useRealTimers();
  });

  it("recovers from a transient setNetworkPolicy blip instead of stopping", async () => {
    vi.useFakeTimers();
    const good = { allow: { b: [] } } as SandboxNetworkPolicy;
    const applied: SandboxNetworkPolicy[] = [];
    let call = 0;
    const sandbox = {
      setNetworkPolicy: (policy: SandboxNetworkPolicy) => {
        call++;

        if (call === 1) return Promise.reject(new Error("transient blip"));
        applied.push(policy);
        return Promise.resolve();
      },
    };

    keepTokenFresh(sandbox, () => Promise.resolve(good), 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(applied).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(applied).toEqual([good]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(applied).toEqual([good, good]);
    vi.useRealTimers();
  });

  it("gives up only after MAX_SET_POLICY_FAILURES consecutive failures (sandbox torn down)", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const sandbox = {
      setNetworkPolicy: () => {
        calls++;
        return Promise.reject(new Error("sandbox torn down"));
      },
    };

    keepTokenFresh(
      sandbox,
      () => Promise.resolve({ allow: {} } as SandboxNetworkPolicy),
      1000,
    );

    await vi.advanceTimersByTimeAsync(1000 * (MAX_SET_POLICY_FAILURES + 5));

    expect(calls).toBe(MAX_SET_POLICY_FAILURES);
    vi.useRealTimers();
  });

  it("gives up after MAX_MINT_FAILURES consecutive mint failures instead of retrying forever", async () => {
    vi.useFakeTimers();
    let mints = 0;
    const sandbox = { setNetworkPolicy: () => Promise.resolve() };

    keepTokenFresh(
      sandbox,
      () => {
        mints++;
        return Promise.reject(new Error("vc link refresh path"));
      },
      1000,
    );
    await vi.advanceTimersByTimeAsync(1000 * (MAX_MINT_FAILURES + 5));

    expect(mints).toBe(MAX_MINT_FAILURES);
    vi.useRealTimers();
  });

  it("resets the mint-failure count on a successful mint", async () => {
    vi.useFakeTimers();
    const applied: SandboxNetworkPolicy[] = [];
    const sandbox = {
      setNetworkPolicy: (policy: SandboxNetworkPolicy) => {
        applied.push(policy);
        return Promise.resolve();
      },
    };
    const good = { allow: { b: [] } } as SandboxNetworkPolicy;
    let call = 0;

    const mintPolicy = () => {
      call++;
      return call === MAX_MINT_FAILURES
        ? Promise.resolve(good)
        : Promise.reject(new Error("still down"));
    };

    keepTokenFresh(sandbox, mintPolicy, 1000);
    await vi.advanceTimersByTimeAsync(1000 * (MAX_MINT_FAILURES + 2));

    expect(applied).toEqual([good]);
    expect(call).toBeGreaterThan(MAX_MINT_FAILURES);
    vi.useRealTimers();
  });

  it("schedules unref'd timers so a pending tick never holds a serverless invocation open", () => {
    const timer = keepTokenFresh(
      { setNetworkPolicy: () => Promise.resolve() },
      () => Promise.resolve({ allow: {} } as SandboxNetworkPolicy),
      60_000,
    );

    expect(timer.hasRef()).toBe(false);
    clearTimeout(timer);
  });
});

describe("mintFreshPolicy", () => {
  it("bypasses @vercel/connect's token cache with forceRefresh", async () => {
    vi.mocked(getToken).mockClear();
    const policy = await mintFreshPolicy();

    expect(getToken).toHaveBeenCalledWith(
      "github/ts-rogue-eve-github",
      { subject: { type: "app" }, scopes: ["*"] },
      { forceRefresh: true },
    );
    const header = `Basic ${Buffer.from("x-access-token:fresh-token").toString("base64")}`;
    const injected = [{ transform: [{ headers: { authorization: header } }] }];
    expect(policy).toEqual({
      allow: {
        "github.com": injected,
        "*.github.com": injected,
        "*": [],
      },
    });
  });
});

describe("keepTokenFresh failure logging", () => {
  it("warns on a mint failure instead of failing silently", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sandbox = { setNetworkPolicy: () => Promise.resolve() };

    keepTokenFresh(sandbox, () => Promise.reject(new Error("oidc expired")), {
      refreshMs: 10000,
      retryMs: 1000,
      initialMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(1000);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("token mint failed"),
      "oidc expired",
    );
    warn.mockRestore();
    vi.useRealTimers();
  });

  it("warns with the failure count on a setNetworkPolicy failure", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sandbox = {
      setNetworkPolicy: () => Promise.reject(new Error("gone")),
    };

    keepTokenFresh(
      sandbox,
      () => Promise.resolve({ allow: {} } as SandboxNetworkPolicy),
      1000,
    );
    await vi.advanceTimersByTimeAsync(1000);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        `setNetworkPolicy failed (1/${MAX_SET_POLICY_FAILURES})`,
      ),
      "gone",
    );
    warn.mockRestore();
    vi.useRealTimers();
  });
});

describe("resolveStartupNetworkPolicy", () => {
  it("comes up authed when the token mint succeeds", async () => {
    const authedPolicy = { allow: { x: [] } } as SandboxNetworkPolicy;
    const res = await resolveStartupNetworkPolicy(
      () => Promise.resolve(authedPolicy),
      1000,
    );
    expect(res).toEqual({ policy: authedPolicy, authed: true });
  });

  it("falls back to an open, unauthenticated policy when every attempt fails", async () => {
    const res = await resolveStartupNetworkPolicy(
      () => Promise.reject(new Error("token down")),
      1000,
      1,
    );
    expect(res.authed).toBe(false);
    expect(res.policy).toEqual({ allow: { "*": [] } });
  });

  it("falls back when the mint hangs past the timeout (no silent stall)", async () => {
    vi.useFakeTimers();
    const pending = resolveStartupNetworkPolicy(
      () => new Promise<SandboxNetworkPolicy>(() => {}),
      1000,
      1,
    );
    await vi.advanceTimersByTimeAsync(1000);
    const res = await pending;
    expect(res.authed).toBe(false);
    expect(res.policy).toEqual({ allow: { "*": [] } });
    vi.useRealTimers();
  });

  it("retries a transient startup blip and comes up authed instead of falling back", async () => {
    vi.useFakeTimers();
    const good = { allow: { x: [] } } as SandboxNetworkPolicy;
    let call = 0;
    const mintPolicy = () => {
      call++;
      return call === 1
        ? Promise.reject(new Error("startup blip"))
        : Promise.resolve(good);
    };

    const pending = resolveStartupNetworkPolicy(mintPolicy, 1000, 2, 500);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(500);
    const res = await pending;

    expect(res).toEqual({ policy: good, authed: true });
    expect(call).toBe(2);
    vi.useRealTimers();
  });

  it("falls back to open only after exhausting every retry attempt", async () => {
    vi.useFakeTimers();
    let call = 0;
    const mintPolicy = () => {
      call++;
      return Promise.reject(new Error("still down"));
    };

    const pending = resolveStartupNetworkPolicy(mintPolicy, 1000, 3, 500);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1000);
    const res = await pending;

    expect(call).toBe(3);
    expect(res.authed).toBe(false);
    expect(res.policy).toEqual({ allow: { "*": [] } });
    vi.useRealTimers();
  });
});

describe("resolveBootstrapNetworkPolicy", () => {
  const authedPolicy = { allow: { x: [] } } as SandboxNetworkPolicy;

  it("returns the policy when the mint came up authed", async () => {
    const policy = await resolveBootstrapNetworkPolicy(() =>
      Promise.resolve({ policy: authedPolicy, authed: true }),
    );
    expect(policy).toEqual(authedPolicy);
  });

  it("throws loudly instead of cloning a private repo unauthenticated", async () => {
    await expect(
      resolveBootstrapNetworkPolicy(() =>
        Promise.resolve({ policy: { allow: { "*": [] } }, authed: false }),
      ),
    ).rejects.toThrow(/GitHub auth could not be minted/);
  });
});

describe("dependencyRevalidationKey", () => {
  it("hashes the lockfile into a stable deps: key that snapshots reuse", () => {
    const key = dependencyRevalidationKey();

    expect(key).toBe(dependencyRevalidationKey());
    expect(key).toMatch(/^deps:[0-9a-f]{64}$/);
  });
});

describe("buildBootstrapCommand", () => {
  it("repoints apt at https before any apt-get call (plain HTTP egress is blocked in-sandbox)", () => {
    const command = buildBootstrapCommand();
    const httpsFixIndex = command.indexOf("https://archive.ubuntu.com");
    const firstAptGetIndex = command.indexOf("apt-get update");
    expect(httpsFixIndex).toBeGreaterThan(-1);
    expect(firstAptGetIndex).toBeGreaterThan(-1);
    expect(httpsFixIndex).toBeLessThan(firstAptGetIndex);
  });

  it("verifies chromium actually launches instead of trusting the install step", () => {
    const command = buildBootstrapCommand();
    expect(command).toContain("playwright install --with-deps chromium");
    expect(command).toContain("chromium.launch()");
  });

  it("installs the agent-friendly CLI toolchain (HAR-3): rg/fd/bat/eza/ast-grep", () => {
    const command = buildBootstrapCommand();
    expect(command).toContain(
      "apt-get install -y tmux ripgrep fd-find bat eza",
    );
    expect(command).toContain("npm install -g @ast-grep/cli");
  });

  it("installs the gh CLI and seeds a placeholder auth config under /workspace (HAR-14, HAR-35)", () => {
    const command = buildBootstrapCommand();
    expect(command).toContain(
      "apt-get install -y tmux ripgrep fd-find bat eza gh",
    );
    expect(command).toContain('mkdir -p "/workspace/.config/gh"');
    expect(command).toContain("/workspace/.config/gh/hosts.yml");
    expect(command).toContain(
      "oauth_token: placeholder-overwritten-by-network-broker",
    );
    expect(command).not.toContain("$HOME/.config/gh");
  });

  it("skips the shell-heredoc gh/git config seeding when seedGitHubConfig is false (HAR-36)", () => {
    const command = buildBootstrapCommand({ seedGitHubConfig: false });
    expect(command).not.toContain("/workspace/.config/gh/hosts.yml");
    expect(command).not.toContain("safe.directory");

    expect(command).toContain(
      "apt-get install -y tmux ripgrep fd-find bat eza gh",
    );
    expect(command).toContain("git init -q -b main .");
  });

  it("installs the ponytail ruleset into pi (HAR-3)", () => {
    const command = buildBootstrapCommand();
    expect(command).toContain(
      "pi install git:github.com/DietrichGebert/ponytail",
    );
  });

  it("symlinks fd/bat onto PATH under their conventional names", () => {
    const command = buildBootstrapCommand();
    expect(command).toContain("ln -sf /usr/bin/fdfind /usr/local/bin/fd");
    expect(command).toContain("ln -sf /usr/bin/batcat /usr/local/bin/bat");
  });

  it("records the screenshot-tooling verdict on both the success and failure path", () => {
    const command = buildBootstrapCommand();
    expect(command).toContain('"available":true');
    expect(command).toContain('"available":false');
    expect(command).toContain(".eve/screenshot-tooling.json");
  });

  it("never lets a failed screenshot-tooling install fail the whole bootstrap", () => {
    const command = buildBootstrapCommand();
    expect(command).toMatch(/\)\s*\|\|\s*echo/);
  });

  it("is syntactically valid bash (parses with `bash -n`)", () => {
    expect(() =>
      execFileSync("bash", ["-n", "-c", buildBootstrapCommand()], {
        stdio: "pipe",
      }),
    ).not.toThrow();
  });
  it("uses in-place git init/remote/fetch/reset instead of git clone (HAR-34)", () => {
    const command = buildBootstrapCommand();
    expect(command).toContain("git init -q -b main .");
    expect(command).toContain("git remote add origin");
    expect(command).toContain("git reset --hard origin/main");

    expect(command).not.toContain(
      "git clone https://github.com/zico-io/ts-rogue.git .",
    );
  });
});

describe("WORKSPACE_GIT_CONFIG_ENV", () => {
  it("targets GH_CONFIG_DIR and GIT_CONFIG_GLOBAL under /workspace (HAR-35)", () => {
    expect(WORKSPACE_GIT_CONFIG_ENV).toEqual({
      GH_CONFIG_DIR: "/workspace/.config/gh",
      GIT_CONFIG_GLOBAL: "/workspace/.gitconfig",
    });
  });
});

describe("AUTO_RECOVER_PUSH_COMMAND", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function setUpRepo() {
    dir = mkdtempSync(join(tmpdir(), "har-5-auto-push-"));
    const origin = join(dir, "origin.git");
    const work = join(dir, "work");
    execFileSync("git", ["init", "-q", "-b", "main", origin]);

    git(origin, ["config", "receive.denyCurrentBranch", "ignore"]);
    execFileSync("git", ["clone", "-q", origin, work]);
    git(work, ["config", "user.email", "t@t.com"]);
    git(work, ["config", "user.name", "t"]);
    execFileSync("sh", ["-c", "echo a > a.txt"], { cwd: work });
    git(work, ["add", "a.txt"]);
    git(work, ["commit", "-q", "-m", "init"]);
    git(work, ["push", "-q", "origin", "main"]);
    return { origin, work };
  }

  const runAutoRecover = (cwd: string) =>
    execFileSync("bash", ["-c", AUTO_RECOVER_PUSH_COMMAND], {
      cwd,
      encoding: "utf8",
    });

  it("pushes commits stranded on an already-tracked branch", () => {
    const { origin, work } = setUpRepo();

    git(work, ["checkout", "-q", "-b", "feature"]);
    git(work, ["push", "-q", "-u", "origin", "feature"]);
    execFileSync("sh", ["-c", "echo b > b.txt"], { cwd: work });
    git(work, ["add", "b.txt"]);
    git(work, ["commit", "-q", "-m", "stranded commit"]);

    const output = runAutoRecover(work);

    expect(output).toContain("auto-recovering 1 unpushed commit(s)");
    const remoteLog = execFileSync(
      "git",
      ["log", "-1", "--format=%s", "feature"],
      { cwd: origin, encoding: "utf8" },
    ).trim();
    expect(remoteLog).toBe("stranded commit");
  });

  it("pushes a brand-new branch that has no upstream yet", () => {
    const { origin, work } = setUpRepo();
    git(work, ["checkout", "-q", "-b", "feature-new"]);
    execFileSync("sh", ["-c", "echo b > b.txt"], { cwd: work });
    git(work, ["add", "b.txt"]);
    git(work, ["commit", "-q", "-m", "new branch commit"]);

    const output = runAutoRecover(work);

    expect(output).toContain("auto-recovering new branch feature-new");
    const branches = execFileSync("git", ["branch", "-a"], {
      cwd: origin,
      encoding: "utf8",
    });
    expect(branches).toContain("feature-new");
  });

  it("does nothing on main", () => {
    const { work } = setUpRepo();

    const output = runAutoRecover(work);

    expect(output.trim()).toBe("");
  });

  it("is a no-op when the branch is already fully pushed", () => {
    const { work } = setUpRepo();
    git(work, ["checkout", "-q", "-b", "feature-clean", "-t", "origin/main"]);
    git(work, ["push", "-q", "-u", "origin", "feature-clean"]);

    const output = runAutoRecover(work);

    expect(output.trim()).toBe("");
  });
});
