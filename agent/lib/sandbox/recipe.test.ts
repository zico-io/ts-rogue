import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  AUTO_RECOVER_PUSH_COMMAND,
  buildBootstrapCommand,
  dependencyRevalidationKey,
  WORKSPACE_GIT_CONFIG_ENV,
} from "./recipe";

/**
 * The environment minus every `GIT_*` variable. Anything that runs the suite
 * from inside a Git operation - a hook, `git bisect run`, `git rebase --exec` -
 * exports `GIT_DIR` and friends, and these tests build real repositories on
 * disk: under an ambient `GIT_DIR`, `git init <path>` re-inits that repo and
 * silently creates nothing at `<path>`.
 */
const GIT_ENV = { ...process.env };
for (const key of Object.keys(GIT_ENV)) {
  if (key.startsWith("GIT_")) delete GIT_ENV[key];
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: GIT_ENV,
  }).trim();
}

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
    execFileSync("git", ["init", "-q", "-b", "main", origin], { env: GIT_ENV });

    git(origin, ["config", "receive.denyCurrentBranch", "ignore"]);
    execFileSync("git", ["clone", "-q", origin, work], { env: GIT_ENV });
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
      env: GIT_ENV,
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
    expect(git(origin, ["log", "-1", "--format=%s", "feature"])).toBe(
      "stranded commit",
    );
  });

  it("pushes a brand-new branch that has no upstream yet", () => {
    const { origin, work } = setUpRepo();
    git(work, ["checkout", "-q", "-b", "feature-new"]);
    execFileSync("sh", ["-c", "echo b > b.txt"], { cwd: work });
    git(work, ["add", "b.txt"]);
    git(work, ["commit", "-q", "-m", "new branch commit"]);

    const output = runAutoRecover(work);

    expect(output).toContain("auto-recovering new branch feature-new");
    expect(git(origin, ["branch", "-a"])).toContain("feature-new");
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
