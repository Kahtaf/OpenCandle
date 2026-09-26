// Regression coverage for the default (non-injected) release runner.
//
// On Windows `npm` is a `.cmd` shim that a `shell: false` spawn refuses to run.
// The default runner must therefore normalize npm commands through
// `buildNpmInvocation` before spawning, while git/node commands and an injected
// runner keep their existing public contract.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawnSync: vi.fn(),
  buildNpmInvocation: vi.fn(),
}));

vi.mock("node:child_process", () => ({ spawnSync: mocks.spawnSync }));
vi.mock("../../scripts/npm-command.mjs", () => ({
  buildNpmInvocation: mocks.buildNpmInvocation,
}));

import { createReleaseDeps } from "../../scripts/release-lib.mjs";

const NPM_CLI = "C:/node/node_modules/npm/bin/npm-cli.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.spawnSync.mockReturnValue({ status: 0, signal: null, stdout: "", stderr: "" });
  mocks.buildNpmInvocation.mockImplementation((tool: string, args: string[]) => {
    if (tool === "npm") {
      return { command: "C:/node/node.exe", args: [NPM_CLI, ...args] };
    }
    return { command: tool, args };
  });
});

describe("default release runner npm normalization", () => {
  it("routes runBump through the resolved npm invocation", () => {
    const deps = createReleaseDeps({ cwd: "/repo" });

    expect(deps.runBump("patch")).toBe(0);

    expect(mocks.buildNpmInvocation).toHaveBeenCalledWith("npm", ["run", "version:patch"]);
    expect(mocks.spawnSync).toHaveBeenCalledWith(
      "C:/node/node.exe",
      [NPM_CLI, "run", "version:patch"],
      expect.objectContaining({ shell: false }),
    );
  });

  it("routes runReleaseCheck through the resolved npm invocation", () => {
    const deps = createReleaseDeps({ cwd: "/repo" });

    expect(deps.runReleaseCheck()).toBe(0);

    expect(mocks.buildNpmInvocation).toHaveBeenCalledWith("npm", ["run", "release:check"]);
    expect(mocks.spawnSync).toHaveBeenCalledWith(
      "C:/node/node.exe",
      [NPM_CLI, "run", "release:check"],
      expect.objectContaining({ shell: false }),
    );
  });

  it("routes release evals through the resolved npm invocation", () => {
    const deps = createReleaseDeps({ cwd: "/repo" });

    expect(deps.runReleaseEvals()).toBe(0);

    expect(mocks.buildNpmInvocation).toHaveBeenCalledWith("npm", ["run", "eval", "--", "release"]);
    expect(mocks.spawnSync).toHaveBeenCalledWith(
      "C:/node/node.exe",
      [NPM_CLI, "run", "eval", "--", "release"],
      expect.objectContaining({ shell: false }),
    );
  });

  it("leaves git commands unchanged and never normalizes them", () => {
    const deps = createReleaseDeps({ cwd: "/repo" });

    expect(deps.isWorkingTreeClean()).toBe(true);

    expect(mocks.buildNpmInvocation).not.toHaveBeenCalled();
    expect(mocks.spawnSync).toHaveBeenCalledWith(
      "git",
      ["status", "--porcelain"],
      expect.objectContaining({ shell: false }),
    );
  });

  it("uses an injected runner verbatim without touching spawn or npm resolution", () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const runner = (command: string, args: string[]) => {
      calls.push({ command, args });
      return { status: 0, signal: null, stdout: "", stderr: "" };
    };

    const deps = createReleaseDeps({ cwd: "/repo", runner });

    expect(deps.runBump("minor")).toBe(0);
    expect(deps.runReleaseCheck()).toBe(0);

    expect(calls).toEqual([
      { command: "npm", args: ["run", "version:minor"] },
      { command: "npm", args: ["run", "release:check"] },
    ]);
    expect(mocks.buildNpmInvocation).not.toHaveBeenCalled();
    expect(mocks.spawnSync).not.toHaveBeenCalled();
  });
});
