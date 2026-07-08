import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const helperPath = resolve(".agents/skills/autoreview/scripts/autoreview");
const opencandlePromptPath = resolve(".agents/skills/autoreview/references/opencandle-review.md");

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
if (stdin.includes("origin/main...HEAD")) {
  throw new Error("OpenCandle prompt file contains branch-only review scope");
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
        "--prompt-file",
        opencandlePromptPath,
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

  it("refuses to resolve a bare-name engine binary that lives inside the repo", () => {
    dir = mkdtempSync(join(tmpdir(), "autoreview-pathhijack-"));
    const repoDir = join(dir, "repo");
    const safeBin = join(dir, "safebin");
    mkdirSync(repoDir);
    mkdirSync(safeBin);
    for (const tool of ["git", "python3"]) {
      const real = execFileSync("which", [tool], { encoding: "utf8" }).trim();
      writeFileSync(join(safeBin, tool), `#!/bin/sh\nexec "${real}" "$@"\n`);
      chmodSync(join(safeBin, tool), 0o755);
    }
    git(repoDir, "init", "--quiet");
    git(repoDir, "checkout", "--quiet", "-B", "main");
    git(repoDir, "config", "user.name", "Autoreview Test");
    git(repoDir, "config", "user.email", "autoreview-test@example.com");
    writeFileSync(join(repoDir, "app.js"), "export const value = 1;\n");
    git(repoDir, "add", "app.js");
    git(repoDir, "commit", "--quiet", "-m", "initial");

    const hijack = join(repoDir, "codex");
    writeFileSync(hijack, "#!/bin/sh\necho hijacked\n");
    chmodSync(hijack, 0o755);

    const result = spawnSync(
      helperPath,
      ["--mode", "commit", "--commit", "HEAD", "--no-web-search"],
      {
        cwd: repoDir,
        encoding: "utf8",
        env: { ...process.env, PATH: `${repoDir}:${safeBin}:/bin:/usr/bin` },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("executable not found: codex");
  });

  it("keeps out-of-scope findings as advisories in the report and JSON output", () => {
    dir = mkdtempSync(join(tmpdir(), "autoreview-oos-"));
    git(dir, "init", "--quiet");
    git(dir, "checkout", "--quiet", "-B", "main");
    git(dir, "config", "user.name", "Autoreview Test");
    git(dir, "config", "user.email", "autoreview-test@example.com");
    writeFileSync(join(dir, "app.js"), "export const value = 1;\n");
    writeFileSync(join(dir, "other.js"), "export const other = 1;\n");
    git(dir, "add", "app.js", "other.js");
    git(dir, "commit", "--quiet", "-m", "initial");
    writeFileSync(join(dir, "app.js"), "export const value = 2;\n");
    git(dir, "commit", "--quiet", "-am", "change app");

    const fakeCodex = join(dir, "fake-codex.js");
    writeFileSync(
      fakeCodex,
      `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output-last-message");
const outputPath = args[outputIndex + 1];
const report = {
  findings: [
    {
      title: "In-scope app change issue",
      body: "The changed file has a defect.",
      priority: "P2",
      confidence: 0.9,
      category: "bug",
      code_location: { file_path: "app.js", line: 1 }
    },
    {
      title: "Blast radius risk in unchanged file",
      body: "A related file outside the diff is affected.",
      priority: "P2",
      confidence: 0.8,
      category: "regression",
      code_location: { file_path: "other.js", line: 1 }
    }
  ],
  overall_correctness: "patch is incorrect",
  overall_explanation: "Fake reviewer reported mixed-scope findings.",
  overall_confidence: 0.9
};
fs.writeFileSync(outputPath, JSON.stringify(report));
`,
    );
    chmodSync(fakeCodex, 0o755);

    const jsonPath = join(dir, "review.json");
    const result = spawnSync(
      helperPath,
      [
        "--mode",
        "commit",
        "--commit",
        "HEAD",
        "--codex-bin",
        fakeCodex,
        "--no-web-search",
        "--json-output",
        jsonPath,
      ],
      { cwd: dir, encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("In-scope app change issue");
    expect(result.stdout).toContain("out-of-scope advisory findings: 1");
    expect(result.stdout).toContain("Blast radius risk in unchanged file");
    const json = JSON.parse(readFileSync(jsonPath, "utf8"));
    expect(json.findings).toHaveLength(1);
    expect(json.out_of_scope_findings).toHaveLength(1);
    expect(json.out_of_scope_findings[0].title).toBe("Blast radius risk in unchanged file");
  });

  it("exits clean but reports the advisory when only out-of-scope findings exist", () => {
    dir = mkdtempSync(join(tmpdir(), "autoreview-oosonly-"));
    git(dir, "init", "--quiet");
    git(dir, "checkout", "--quiet", "-B", "main");
    git(dir, "config", "user.name", "Autoreview Test");
    git(dir, "config", "user.email", "autoreview-test@example.com");
    writeFileSync(join(dir, "app.js"), "export const value = 1;\n");
    writeFileSync(join(dir, "other.js"), "export const other = 1;\n");
    git(dir, "add", "app.js", "other.js");
    git(dir, "commit", "--quiet", "-m", "initial");
    writeFileSync(join(dir, "app.js"), "export const value = 2;\n");
    git(dir, "commit", "--quiet", "-am", "change app");

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
    title: "Blast radius risk in unchanged file",
    body: "A related file outside the diff is affected.",
    priority: "P2",
    confidence: 0.8,
    category: "regression",
    code_location: { file_path: "other.js", line: 1 }
  }],
  overall_correctness: "patch is incorrect",
  overall_explanation: "Fake reviewer reported only an out-of-scope finding.",
  overall_confidence: 0.9
};
fs.writeFileSync(outputPath, JSON.stringify(report));
`,
    );
    chmodSync(fakeCodex, 0o755);

    const result = spawnSync(
      helperPath,
      ["--mode", "commit", "--commit", "HEAD", "--codex-bin", fakeCodex, "--no-web-search"],
      { cwd: dir, encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("out-of-scope advisory findings: 1");
    expect(result.stdout).toContain("Blast radius risk in unchanged file");
  });

  it("injects the review scope policy into the reviewer prompt", () => {
    dir = mkdtempSync(join(tmpdir(), "autoreview-scopepolicy-"));
    git(dir, "init", "--quiet");
    git(dir, "checkout", "--quiet", "-B", "main");
    git(dir, "config", "user.name", "Autoreview Test");
    git(dir, "config", "user.email", "autoreview-test@example.com");
    writeFileSync(join(dir, "app.js"), "export const value = 1;\n");
    git(dir, "add", "app.js");
    git(dir, "commit", "--quiet", "-m", "initial");
    writeFileSync(join(dir, "app.js"), "export const value = 2;\n");
    git(dir, "commit", "--quiet", "-am", "change app");

    const fakeCodex = join(dir, "fake-codex.js");
    writeFileSync(
      fakeCodex,
      `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output-last-message");
const outputPath = args[outputIndex + 1];
const stdin = fs.readFileSync(0, "utf8");
if (!stdin.includes("Review scope discipline")) {
  throw new Error("scope policy missing from reviewer prompt");
}
const report = {
  findings: [],
  overall_correctness: "patch is correct",
  overall_explanation: "Fake reviewer saw the scope policy.",
  overall_confidence: 0.9
};
fs.writeFileSync(outputPath, JSON.stringify(report));
`,
    );
    chmodSync(fakeCodex, 0o755);

    const result = spawnSync(
      helperPath,
      ["--mode", "commit", "--commit", "HEAD", "--codex-bin", fakeCodex, "--no-web-search"],
      { cwd: dir, encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("clean");
  });

  it("splits an over-budget diff into file batches and merges the batch reports", () => {
    dir = mkdtempSync(join(tmpdir(), "autoreview-batch-"));
    git(dir, "init", "--quiet");
    git(dir, "checkout", "--quiet", "-B", "main");
    git(dir, "config", "user.name", "Autoreview Test");
    git(dir, "config", "user.email", "autoreview-test@example.com");
    const bigA = Array.from({ length: 60 }, (_, i) => `export const alpha${i} = ${i};`).join("\n");
    const bigB = Array.from({ length: 60 }, (_, i) => `export const beta${i} = ${i};`).join("\n");
    writeFileSync(join(dir, "alpha.js"), "export const alpha = 1;\n");
    writeFileSync(join(dir, "beta.js"), "export const beta = 1;\n");
    git(dir, "add", "alpha.js", "beta.js");
    git(dir, "commit", "--quiet", "-m", "initial");
    writeFileSync(join(dir, "alpha.js"), `${bigA}\n`);
    writeFileSync(join(dir, "beta.js"), `${bigB}\n`);
    git(dir, "commit", "--quiet", "-am", "grow both files");

    const fakeCodex = join(dir, "fake-codex.js");
    writeFileSync(
      fakeCodex,
      `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output-last-message");
const outputPath = args[outputIndex + 1];
const stdin = fs.readFileSync(0, "utf8");
const hasAlpha = stdin.includes("export const alpha7 = 7;");
const hasBeta = stdin.includes("export const beta7 = 7;");
if (hasAlpha && hasBeta) {
  throw new Error("batch contained both files despite the batch budget");
}
if (!hasAlpha && !hasBeta) {
  throw new Error("batch contained neither changed file");
}
if (!stdin.includes("Review Batch")) {
  throw new Error("batch preamble missing from prompt");
}
if (!stdin.includes("alpha.js") || !stdin.includes("beta.js")) {
  throw new Error("shared diffstat header missing full changed-file list");
}
const file = hasAlpha ? "alpha.js" : "beta.js";
const report = {
  findings: [{
    title: "Issue in " + file,
    body: "Fake finding for " + file,
    priority: "P2",
    confidence: 0.9,
    category: "bug",
    code_location: { file_path: file, line: 1 }
  }],
  overall_correctness: "patch is incorrect",
  overall_explanation: "Fake batch reviewer reported a finding.",
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
        "commit",
        "--commit",
        "HEAD",
        "--codex-bin",
        fakeCodex,
        "--no-web-search",
        "--batch-budget",
        "2500",
      ],
      { cwd: dir, encoding: "utf8" },
    );

    expect(result.stderr).not.toContain("engine failed");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("batches: 2");
    expect(result.stdout).toContain("Issue in alpha.js");
    expect(result.stdout).toContain("Issue in beta.js");
  });

  it("keeps the loud truncation path when batching is off", () => {
    dir = mkdtempSync(join(tmpdir(), "autoreview-batchoff-"));
    git(dir, "init", "--quiet");
    git(dir, "checkout", "--quiet", "-B", "main");
    git(dir, "config", "user.name", "Autoreview Test");
    git(dir, "config", "user.email", "autoreview-test@example.com");
    const big = Array.from({ length: 120 }, (_, i) => `export const value${i} = ${i};`).join("\n");
    writeFileSync(join(dir, "app.js"), "export const value = 1;\n");
    git(dir, "add", "app.js");
    git(dir, "commit", "--quiet", "-m", "initial");
    writeFileSync(join(dir, "app.js"), `${big}\n`);
    git(dir, "commit", "--quiet", "-am", "grow app");

    const fakeCodex = join(dir, "fake-codex.js");
    writeFileSync(
      fakeCodex,
      `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output-last-message");
const outputPath = args[outputIndex + 1];
const stdin = fs.readFileSync(0, "utf8");
if (!stdin.includes("[truncated at")) {
  throw new Error("expected inline truncation marker in bundle");
}
const report = {
  findings: [],
  overall_correctness: "patch is correct",
  overall_explanation: "Fake reviewer over a truncated bundle.",
  overall_confidence: 0.9
};
fs.writeFileSync(outputPath, JSON.stringify(report));
`,
    );
    chmodSync(fakeCodex, 0o755);

    const jsonPath = join(dir, "review.json");
    const result = spawnSync(
      helperPath,
      [
        "--mode",
        "commit",
        "--commit",
        "HEAD",
        "--codex-bin",
        fakeCodex,
        "--no-web-search",
        "--batch",
        "off",
        "--batch-budget",
        "1500",
        "--json-output",
        jsonPath,
      ],
      { cwd: dir, encoding: "utf8" },
    );

    expect(result.stderr).not.toContain("engine failed");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("notices: 1");
    expect(result.stdout).toContain("truncated");
    const json = JSON.parse(readFileSync(jsonPath, "utf8"));
    expect(json.notices).toHaveLength(1);
    expect(json.notices[0]).toContain("truncated");
  });

  it("splits patches at file and hunk boundaries with greedy packing", () => {
    const pythonProbe = `
import json
ns = {"__name__": "autoreview_under_test"}
path = ${JSON.stringify(helperPath)}
exec(compile(open(path).read(), path, "exec"), ns)

patch = (
    "diff --git a/one.js b/one.js\\n"
    "index 111..222 100644\\n"
    "--- a/one.js\\n"
    "+++ b/one.js\\n"
    "@@ -1,2 +1,2 @@\\n"
    "-old one\\n"
    "+new one\\n"
    "diff --git a/two.js b/two.js\\n"
    "index 333..444 100644\\n"
    "--- a/two.js\\n"
    "+++ b/two.js\\n"
    "@@ -1,2 +1,2 @@\\n"
    "-old two\\n"
    "+new two\\n"
    "@@ -50,2 +50,2 @@\\n"
    "-old tail\\n"
    "+new tail\\n"
)
segments = ns["split_patch_by_file"](patch)
assert [p for p, _ in segments] == ["one.js", "two.js"], segments
assert segments[0][1].startswith("diff --git a/one.js"), segments[0]
assert "new tail" in segments[1][1]

pieces = ns["split_segment_by_hunk"]("two.js", segments[1][1], 140)
assert len(pieces) == 2, pieces
assert all(p == "two.js" for p, _ in pieces)
assert "new two" in pieces[0][1] and "new tail" not in pieces[0][1]
assert "new tail" in pieces[1][1]
assert pieces[1][1].startswith("diff --git a/two.js"), pieces[1][1]

batches = ns["plan_batches"]("HEADER", segments, 1200)
assert len(batches) == 1, batches
assert "Review Batch" not in batches[0]

batches = ns["plan_batches"]("HEADER", segments, 600)
assert len(batches) == 2, [len(b) for b in batches]
assert all(b.startswith("HEADER") for b in batches)
assert "Review Batch 1 of 2" in batches[0]
print("ok")
`;
    const result = spawnSync("python3", ["-c", pythonProbe], { encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("ok");
  });

  function setupSignalRepo(base: string, opts: { suppressed: boolean }): void {
    git(base, "init", "--quiet");
    git(base, "checkout", "--quiet", "-B", "main");
    git(base, "config", "user.name", "Autoreview Test");
    git(base, "config", "user.email", "autoreview-test@example.com");
    writeFileSync(join(base, "README.md"), "# fixture\n");
    git(base, "add", "README.md");
    git(base, "commit", "--quiet", "-m", "initial");

    mkdirSync(join(base, "gui", "server"), { recursive: true });
    mkdirSync(join(base, "src", "memory"), { recursive: true });
    mkdirSync(join(base, "src", "providers"), { recursive: true });
    mkdirSync(join(base, "src", "prompts"), { recursive: true });
    const guardLine = opts.suppressed
      ? "  if (!isTrustedPrivateApiRequest(req)) return deny();\n"
      : "";
    // The unsuppressed variant pairs a guarded route with an unguarded one:
    // guard text elsewhere in the file must not mute the per-route signal.
    const guardedSibling = opts.suppressed
      ? ""
      : 'app.get("/api/safe", (req, res) => {\n  if (!isTrustedPrivateApiRequest(req)) return deny();\n  res.json({ ok: true });\n});\n';
    writeFileSync(
      join(base, "gui", "server", "http-routes.ts"),
      `${guardedSibling}app.get("/api/things", (req, res) => {\n${guardLine}  res.json([]);\n});\n`,
    );
    writeFileSync(join(base, "src", "memory", "sqlite.ts"), "const CURRENT_SCHEMA_VERSION = 9;\n");
    const infraLine = opts.suppressed
      ? 'import { rateLimiter } from "../infra/rate-limiter.js";\n'
      : "";
    writeFileSync(
      join(base, "src", "providers", "quotes.ts"),
      `${infraLine}export async function getQuote(url: string) {\n  return fetch(url);\n}\n`,
    );
    writeFileSync(join(base, "src", "prompts", "policy.ts"), "export const policy = 'x';\n");
    const files = [
      "gui/server/http-routes.ts",
      "src/memory/sqlite.ts",
      "src/providers/quotes.ts",
      "src/prompts/policy.ts",
    ];
    if (opts.suppressed) {
      mkdirSync(join(base, "tests", "unit", "memory"), { recursive: true });
      mkdirSync(join(base, "tests", "unit", "prompts"), { recursive: true });
      writeFileSync(
        join(base, "tests", "unit", "memory", "sqlite.test.ts"),
        "// migration coverage\n",
      );
      writeFileSync(
        join(base, "tests", "unit", "prompts", "policy.test.ts"),
        "// prompt coverage\n",
      );
      writeFileSync(join(base, "CHANGELOG.md"), "## [Unreleased]\n- fixture change\n");
      files.push(
        "tests/unit/memory/sqlite.test.ts",
        "tests/unit/prompts/policy.test.ts",
        "CHANGELOG.md",
      );
    }
    git(base, "add", ...files);
    git(base, "commit", "--quiet", "-m", "feature change");
  }

  function signalFakeCodex(base: string, expectation: "present" | "absent"): string {
    const fakeCodex = join(base, "fake-codex.js");
    const check =
      expectation === "present"
        ? `const ids = ["gui-server-trust-boundary", "direct-fetch-bypass", "sqlite-migration", "prompt-routing-fixtures", "changelog-missing"];
if (!stdin.includes("# Diff Signals")) throw new Error("diff signals block missing");
for (const id of ids) {
  if (!stdin.includes(id)) throw new Error("missing signal: " + id);
}`
        : `if (stdin.includes("# Diff Signals")) throw new Error("diff signals block should be absent");`;
    writeFileSync(
      fakeCodex,
      `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output-last-message");
const outputPath = args[outputIndex + 1];
const stdin = fs.readFileSync(0, "utf8");
${check}
const report = {
  findings: [],
  overall_correctness: "patch is correct",
  overall_explanation: "Fake reviewer processed diff signals.",
  overall_confidence: 0.9
};
fs.writeFileSync(outputPath, JSON.stringify(report));
`,
    );
    chmodSync(fakeCodex, 0o755);
    return fakeCodex;
  }

  it("injects advisory diff signals without affecting the exit code", () => {
    dir = mkdtempSync(join(tmpdir(), "autoreview-signals-"));
    setupSignalRepo(dir, { suppressed: false });
    const fakeCodex = signalFakeCodex(dir, "present");

    const jsonPath = join(dir, "review.json");
    const result = spawnSync(
      helperPath,
      [
        "--mode",
        "commit",
        "--commit",
        "HEAD",
        "--codex-bin",
        fakeCodex,
        "--no-web-search",
        "--json-output",
        jsonPath,
      ],
      { cwd: dir, encoding: "utf8" },
    );

    expect(result.stderr).not.toContain("engine failed");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("pre-check signals: 5");
    const json = JSON.parse(readFileSync(jsonPath, "utf8"));
    expect(json.signals).toHaveLength(5);
    expect(json.signals.map((signal: { id: string }) => signal.id)).toContain(
      "gui-server-trust-boundary",
    );
  });

  it("suppresses diff signals when guards, fixtures, and changelog updates are present", () => {
    dir = mkdtempSync(join(tmpdir(), "autoreview-signals-clean-"));
    setupSignalRepo(dir, { suppressed: true });
    const fakeCodex = signalFakeCodex(dir, "absent");

    const result = spawnSync(
      helperPath,
      ["--mode", "commit", "--commit", "HEAD", "--codex-bin", fakeCodex, "--no-web-search"],
      { cwd: dir, encoding: "utf8" },
    );

    expect(result.stderr).not.toContain("engine failed");
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("pre-check signals");
  });

  it("disables diff signals with --diff-signals off", () => {
    dir = mkdtempSync(join(tmpdir(), "autoreview-signals-off-"));
    setupSignalRepo(dir, { suppressed: false });
    const fakeCodex = signalFakeCodex(dir, "absent");

    const result = spawnSync(
      helperPath,
      [
        "--mode",
        "commit",
        "--commit",
        "HEAD",
        "--codex-bin",
        fakeCodex,
        "--no-web-search",
        "--diff-signals",
        "off",
      ],
      { cwd: dir, encoding: "utf8" },
    );

    expect(result.stderr).not.toContain("engine failed");
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("pre-check signals");
  });

  function reactDoctorSkipFakeCodex(repoDir: string, expectedHead: string): string {
    const fakeCodex = join(repoDir, "fake-codex.js");
    writeFileSync(
      fakeCodex,
      `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output-last-message");
const outputPath = args[outputIndex + 1];
const stdin = fs.readFileSync(0, "utf8");
if (!stdin.includes("# React Doctor")) {
  throw new Error("React Doctor evidence missing");
}
if (!stdin.includes('"status": "skipped"')) {
  throw new Error("React Doctor skip status missing");
}
if (!stdin.includes('"headRef": "${expectedHead}"')) {
  throw new Error("React Doctor skip head ref missing");
}
const report = {
  findings: [],
  overall_correctness: "patch is correct",
  overall_explanation: "Fake reviewer accepted skipped React Doctor evidence.",
  overall_confidence: 0.9
};
fs.writeFileSync(outputPath, JSON.stringify(report));
`,
    );
    chmodSync(fakeCodex, 0o755);
    return fakeCodex;
  }

  function fakeFailingNpx(repoDir: string): string {
    const fakeNpx = join(repoDir, "npx");
    writeFileSync(fakeNpx, "#!/bin/sh\necho react doctor should have been skipped >&2\nexit 99\n");
    chmodSync(fakeNpx, 0o755);
    return fakeNpx;
  }

  it("skips React Doctor for range reviews whose head is not checked out", () => {
    dir = mkdtempSync(join(tmpdir(), "autoreview-react-range-skip-"));
    git(dir, "init", "--quiet");
    git(dir, "checkout", "--quiet", "-B", "main");
    git(dir, "config", "user.name", "Autoreview Test");
    git(dir, "config", "user.email", "autoreview-test@example.com");
    mkdirSync(join(dir, "gui/web/src"), { recursive: true });
    writeFileSync(join(dir, "gui/web/src/App.jsx"), "export function App() { return null; }\n");
    git(dir, "add", "gui/web/src/App.jsx");
    git(dir, "commit", "--quiet", "-m", "initial gui");
    const base = git(dir, "rev-parse", "HEAD");

    writeFileSync(
      join(dir, "gui/web/src/App.jsx"),
      "export function App() { return <main>changed</main>; }\n",
    );
    git(dir, "commit", "--quiet", "-am", "change gui");
    const reviewedHead = git(dir, "rev-parse", "HEAD");

    writeFileSync(join(dir, "README.md"), "later unrelated checkout change\n");
    git(dir, "add", "README.md");
    git(dir, "commit", "--quiet", "-m", "later unrelated change");

    const fakeCodex = reactDoctorSkipFakeCodex(dir, reviewedHead);
    fakeFailingNpx(dir);
    const result = spawnSync(
      helperPath,
      [
        "--mode",
        "range",
        "--base",
        base,
        "--head",
        reviewedHead,
        "--codex-bin",
        fakeCodex,
        "--no-web-search",
      ],
      { cwd: dir, encoding: "utf8", env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("react-doctor: skipped");
    expect(result.stderr).not.toContain("react doctor should have been skipped");
  });

  it("skips React Doctor for commit reviews whose commit is not checked out", () => {
    dir = mkdtempSync(join(tmpdir(), "autoreview-react-commit-skip-"));
    git(dir, "init", "--quiet");
    git(dir, "checkout", "--quiet", "-B", "main");
    git(dir, "config", "user.name", "Autoreview Test");
    git(dir, "config", "user.email", "autoreview-test@example.com");
    mkdirSync(join(dir, "gui/web/src"), { recursive: true });
    writeFileSync(join(dir, "gui/web/src/App.jsx"), "export function App() { return null; }\n");
    git(dir, "add", "gui/web/src/App.jsx");
    git(dir, "commit", "--quiet", "-m", "initial gui");

    writeFileSync(
      join(dir, "gui/web/src/App.jsx"),
      "export function App() { return <main>changed</main>; }\n",
    );
    git(dir, "commit", "--quiet", "-am", "change gui");
    const reviewedCommit = git(dir, "rev-parse", "HEAD");

    writeFileSync(join(dir, "README.md"), "later unrelated checkout change\n");
    git(dir, "add", "README.md");
    git(dir, "commit", "--quiet", "-m", "later unrelated change");

    const fakeCodex = reactDoctorSkipFakeCodex(dir, reviewedCommit);
    fakeFailingNpx(dir);
    const result = spawnSync(
      helperPath,
      ["--mode", "commit", "--commit", reviewedCommit, "--codex-bin", fakeCodex, "--no-web-search"],
      { cwd: dir, encoding: "utf8", env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("react-doctor: skipped");
    expect(result.stderr).not.toContain("react doctor should have been skipped");
  }, 15_000);

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
