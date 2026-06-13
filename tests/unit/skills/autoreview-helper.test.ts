import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const helperPath = resolve(".agents/skills/autoreview/scripts/autoreview");

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

describe("autoreview helper", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("validates findings against files changed by a merge commit", () => {
    dir = mkdtempSync(join(tmpdir(), "autoreview-merge-"));
    git(dir, "init", "--quiet");
    git(dir, "checkout", "--quiet", "-B", "main");
    git(dir, "config", "user.name", "Autoreview Test");
    git(dir, "config", "user.email", "autoreview-test@example.com");
    writeFileSync(join(dir, "app.js"), "export const value = 1;\n");
    git(dir, "add", "app.js");
    git(dir, "commit", "--quiet", "-m", "initial");

    git(dir, "checkout", "--quiet", "-b", "feature");
    writeFileSync(join(dir, "app.js"), "export const value = 2;\n");
    git(dir, "commit", "--quiet", "-am", "change app");

    git(dir, "checkout", "--quiet", "main");
    git(dir, "merge", "--quiet", "--no-ff", "feature", "-m", "merge feature");
    const mergeCommit = git(dir, "rev-parse", "HEAD");

    const fakeCodex = join(dir, "fake-codex.js");
    writeFileSync(
      fakeCodex,
      `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output-last-message");
const outputPath = args[outputIndex + 1];
const report = {
  findings: [{
    title: "Changed app behavior needs review",
    body: "The changed file should be considered in-scope for merge commit review.",
    priority: "P2",
    confidence: 0.9,
    category: "regression",
    code_location: { file_path: "app.js", line: 1 }
  }],
  overall_correctness: "patch is incorrect",
  overall_explanation: "Fake reviewer reported an in-scope finding.",
  overall_confidence: 0.9
};
fs.writeFileSync(outputPath, JSON.stringify(report));
`,
    );
    chmodSync(fakeCodex, 0o755);

    const result = spawnSync(
      helperPath,
      ["--mode", "commit", "--commit", mergeCommit, "--codex-bin", fakeCodex, "--no-web-search"],
      { cwd: dir, encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Changed app behavior needs review");
    expect(result.stderr).not.toContain("out-of-scope");
  });

  it("reviews the diff between an explicit base and head commit", () => {
    dir = mkdtempSync(join(tmpdir(), "autoreview-range-"));
    git(dir, "init", "--quiet");
    git(dir, "checkout", "--quiet", "-B", "main");
    git(dir, "config", "user.name", "Autoreview Test");
    git(dir, "config", "user.email", "autoreview-test@example.com");
    writeFileSync(join(dir, "app.js"), "export const value = 1;\n");
    git(dir, "add", "app.js");
    git(dir, "commit", "--quiet", "-m", "initial");
    const base = git(dir, "rev-parse", "HEAD");

    writeFileSync(join(dir, "app.js"), "export const value = 2;\n");
    git(dir, "commit", "--quiet", "-am", "change app");
    const middle = git(dir, "rev-parse", "HEAD");

    writeFileSync(join(dir, "ignored.js"), "export const ignored = true;\n");
    git(dir, "add", "ignored.js");
    git(dir, "commit", "--quiet", "-m", "ignored outside range");
    const head = git(dir, "rev-parse", "HEAD");

    const fakeCodex = join(dir, "fake-codex.js");
    writeFileSync(
      fakeCodex,
      `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output-last-message");
const outputPath = args[outputIndex + 1];
const stdin = fs.readFileSync(0, "utf8");
if (!stdin.includes("base: ${base}") || !stdin.includes("head: ${middle}")) {
  throw new Error("range metadata missing from review bundle");
}
if (!stdin.includes("export const value = 2;")) {
  throw new Error("range patch missing changed app.js content");
}
if (stdin.includes("ignored.js")) {
  throw new Error("range bundle included commits after the requested head");
}
const report = {
  findings: [{
    title: "Changed app behavior needs review",
    body: "The changed file should be considered in-scope for range review.",
    priority: "P2",
    confidence: 0.9,
    category: "regression",
    code_location: { file_path: "app.js", line: 1 }
  }],
  overall_correctness: "patch is incorrect",
  overall_explanation: "Fake reviewer reported an in-scope finding.",
  overall_confidence: 0.9
};
fs.writeFileSync(outputPath, JSON.stringify(report));
`,
    );
    chmodSync(fakeCodex, 0o755);

    const result = spawnSync(
      helperPath,
      [
        "--mode",
        "range",
        "--base",
        base,
        "--head",
        middle,
        "--commit",
        head,
        "--codex-bin",
        fakeCodex,
        "--no-web-search",
      ],
      { cwd: dir, encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Changed app behavior needs review");
    expect(result.stderr).not.toContain("out-of-scope");
  });

  it("fails forced branch review when the worktree has uncommitted changes", () => {
    dir = mkdtempSync(join(tmpdir(), "autoreview-dirty-"));
    git(dir, "init", "--quiet");
    git(dir, "checkout", "--quiet", "-B", "main");
    git(dir, "config", "user.name", "Autoreview Test");
    git(dir, "config", "user.email", "autoreview-test@example.com");
    writeFileSync(join(dir, "app.js"), "export const value = 1;\n");
    git(dir, "add", "app.js");
    git(dir, "commit", "--quiet", "-m", "initial");
    writeFileSync(join(dir, "app.js"), "export const value = 2;\n");

    const result = spawnSync(helperPath, ["--mode", "branch", "--base", "HEAD", "--dry-run"], {
      cwd: dir,
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("branch review requires a clean worktree");
  });
});
