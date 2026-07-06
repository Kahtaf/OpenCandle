import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendRunIndexEntry,
  diffRunReports,
  listEvalSuites,
  resolveEvalCommand,
  summarizeReleaseResults,
} from "../../scripts/run-evals-table.js";

describe("eval front door dispatch table", () => {
  it("keeps npm eval scripts limited to the promoted front door", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf-8")) as {
      scripts?: Record<string, string>;
    };

    expect(
      Object.keys(packageJson.scripts ?? {}).filter((name) => name.startsWith("eval:")),
    ).toEqual([]);
    expect(
      Object.keys(packageJson.scripts ?? {}).filter((name) => name.startsWith("test:evals")),
    ).toEqual([]);
    expect(packageJson.scripts?.eval).toBe("tsx tests/scripts/run-evals.ts");
  });

  it("runs resolved eval commands without shell argument parsing", () => {
    const frontDoorSource = readFileSync("tests/scripts/run-evals.ts", "utf-8");

    expect(frontDoorSource).toContain("spawnSync(resolved.command, resolved.args");
    expect(frontDoorSource).toContain("shell: false");
    expect(frontDoorSource).not.toContain("shell: true");
  });

  it("lists every suite from the consolidation design", () => {
    expect(listEvalSuites().map((suite) => suite.id)).toEqual([
      "cases",
      "product",
      "competitive",
      "competitive:frozen",
      "competitive:analyze",
      "router-live",
      "replay:product",
      "replay:competitive",
      "scorecard",
      "prompt-policy",
      "prompt-policy:parity",
      "release",
    ]);
  });

  it("resolves suite ids to the delegated command without reimplementing suite logic", () => {
    expect(resolveEvalCommand("cases", [])).toMatchObject({
      command: "vitest",
      args: ["run", "--config", "vitest.config.evals.ts"],
      env: {},
    });
    expect(resolveEvalCommand("product", [])).toMatchObject({
      command: "tsx",
      args: ["tests/scripts/run-product-evals.ts"],
    });
    expect(resolveEvalCommand("competitive:frozen", [])).toMatchObject({
      command: "tsx",
      args: ["tests/scripts/run-competitive-finance-eval.ts"],
      env: { OPENCANDLE_COMPETITIVE_PANEL: "frozen" },
    });
    expect(resolveEvalCommand("router-live", [])).toMatchObject({
      command: "tsx",
      args: ["tests/scripts/run-live-router-eval.ts"],
    });
    expect(resolveEvalCommand("replay:product", [])).toMatchObject({
      command: "tsx",
      args: ["tests/scripts/run-main-branch-product-replay.ts"],
    });
    expect(
      resolveEvalCommand("replay:competitive", ["--current-report", "now.json"]),
    ).toMatchObject({
      command: "tsx",
      args: ["tests/scripts/run-main-branch-competitive-replay.ts", "--current-report", "now.json"],
      env: {},
    });
    expect(resolveEvalCommand("scorecard", ["--product-replay", "product.json"])).toMatchObject({
      command: "tsx",
      args: ["tests/scripts/build-oc-superiority-scorecard.ts", "--product-replay", "product.json"],
      env: {},
    });
    expect(resolveEvalCommand("prompt-policy", [])).toMatchObject({
      command: "tsx",
      args: ["tests/scripts/run-prompt-policy-manifest.ts"],
    });
    expect(resolveEvalCommand("prompt-policy:parity", [])).toMatchObject({
      command: "tsx",
      args: ["tests/scripts/run-prompt-policy-ref-parity.ts"],
    });
  });

  it("prints the known suite list when an unknown suite is requested", () => {
    expect(() => resolveEvalCommand("missing", [])).toThrow(
      /Unknown eval suite "missing".*cases.*product.*release/s,
    );
  });

  it("maps front-door options to existing env flags", () => {
    expect(resolveEvalCommand("cases", ["--tier", "usually"]).env).toEqual({
      EVAL_TIER: "usually",
    });
    expect(resolveEvalCommand("cases", ["--known-fail", "e1"]).env).toEqual({
      EVAL_TIER: "usually",
      OPENCANDLE_LIVE_MULTI_TURN_EVAL: "1",
      OPENCANDLE_RUN_KNOWN_FAIL_EVALS: "1",
    });
    expect(resolveEvalCommand("cases", ["--known-fail", "e2"]).env).toEqual({
      EVAL_TIER: "usually",
      OPENCANDLE_EVAL_KNOWN_FAIL_E2: "1",
    });
    expect(
      resolveEvalCommand("product", [
        "--case",
        "portfolio-1",
        "--family",
        "portfolio",
        "--include-opt-in",
        "--limit",
        "2",
      ]).env,
    ).toEqual({
      PRODUCT_EVAL_CASE: "portfolio-1",
      PRODUCT_EVAL_FAMILY: "portfolio",
      PRODUCT_EVAL_INCLUDE_OPT_IN: "1",
      PRODUCT_EVAL_LIMIT: "2",
    });
    expect(
      resolveEvalCommand("router-live", ["--provider", "google", "--model", "gemini"]).env,
    ).toEqual({
      OPENCANDLE_ROUTER_PROVIDER: "google",
      OPENCANDLE_ROUTER_MODEL: "gemini",
    });
    expect(resolveEvalCommand("replay:product", ["--base-ref", "main"]).env).toEqual({
      PRODUCT_REPLAY_BASE_REF: "main",
    });
    expect(
      resolveEvalCommand("prompt-policy", ["--ids", "a,b", "--limit", "1", "--strict"]).env,
    ).toEqual({
      PROMPT_POLICY_IDS: "a,b",
      PROMPT_POLICY_LIMIT: "1",
      PROMPT_POLICY_STRICT: "1",
    });
    expect(
      resolveEvalCommand("prompt-policy:parity", ["--base-ref", "main", "--current-ref", "HEAD"])
        .env,
    ).toEqual({
      PROMPT_POLICY_BASE_REF: "main",
      PROMPT_POLICY_CURRENT_REF: "HEAD",
    });
  });

  it("aggregates release results and fails when any child suite fails", () => {
    const result = summarizeReleaseResults([
      { suite: "router-live", exitCode: 0 },
      { suite: "cases", exitCode: 1 },
      { suite: "product", exitCode: 0 },
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.rows).toEqual([
      { suite: "router-live", status: "PASS", exitCode: 0 },
      { suite: "cases", status: "FAIL", exitCode: 1 },
      { suite: "product", status: "PASS", exitCode: 0 },
    ]);
  });
});

describe("eval run index", () => {
  it("discovers new reports by directory diff and appends one JSONL index line", () => {
    const cwd = mkdtempSync(join(tmpdir(), "oc-eval-index-"));
    const runsDir = join(cwd, "tests", "evals", "runs");
    mkdirSync(runsDir, { recursive: true });
    writeFileSync(join(runsDir, "before.json"), "{}\n", "utf-8");
    const before = new Set(["before.json"]);
    writeFileSync(join(runsDir, "after_product-evals.json"), "{}\n", "utf-8");

    const reports = diffRunReports(runsDir, before, cwd);
    appendRunIndexEntry({
      cwd,
      suite: "product",
      startedAt: "2026-07-05T00:00:00.000Z",
      finishedAt: "2026-07-05T00:00:01.000Z",
      exitCode: 0,
      reports,
      argv: ["product"],
    });

    expect(reports).toEqual(["tests/evals/runs/after_product-evals.json"]);
    const [line] = readFileSync(join(runsDir, "index.jsonl"), "utf-8").trim().split("\n");
    expect(JSON.parse(line)).toEqual({
      suite: "product",
      startedAt: "2026-07-05T00:00:00.000Z",
      finishedAt: "2026-07-05T00:00:01.000Z",
      exitCode: 0,
      reports: ["tests/evals/runs/after_product-evals.json"],
      argv: ["product"],
    });
  });
});
