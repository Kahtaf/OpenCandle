import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeCompetitorSkipMetadata } from "../../evals/competitive-completion.js";
import {
  canonicalizeVitestCaseId,
  canonicalReleaseEnv,
  cleanReleaseEnv,
  collectRealExpectedCaseIds,
  DEFAULT_OPTIONAL_CASE_IDS,
  type ExpectedCaseIds,
  listVitestCaseIds,
  normalizeExpectedCaseIds,
  type ReleaseEvidenceDeps,
  type ReleaseSuiteExecution,
  type ReleaseSuiteRequest,
  releaseArgumentProblem,
  runReleaseWithEvidence,
} from "../../scripts/release-eval-evidence.js";

const REPO_ROOT = process.cwd();
const ID_FIXTURE_PATH = "tests/fixtures/eval-runner/id-canonicalization.fixture.ts";
const CANDIDATE = {
  commit: "a".repeat(40),
  sourceDigest: "sha256:source",
  lockDigest: "sha256:lock",
  policyDigest: "sha256:policy",
};

/**
 * Explicit default-tier child env for the real placeholder spawn. Inheriting
 * `process.env` would let an ambient `EVAL_TIER=usually` (or an opt-in flag)
 * run live cases inside a default-tier proof. Blanking the keys rather than
 * deleting them also stops the child's `loadEnv()` from restoring them, and
 * blanking the model credentials keeps a regressed case off a live model.
 */
function defaultTierPlaceholderEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const key of [
    "EVAL_TIER",
    "OPENCANDLE_LIVE_MULTI_TURN_EVAL",
    "OPENCANDLE_RUN_KNOWN_FAIL_EVALS",
    "OPENCANDLE_EVAL_KNOWN_FAIL_E2",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "OPENROUTER_API_KEY",
    "TYPESAFE_API_KEY",
  ]) {
    env[key] = "";
  }
  return env;
}

/**
 * Minimal explicit config for the out-of-discovery fixture. Written to a temp
 * dir with an absolute root so no default project include ever picks it up.
 */
function writeIdFixtureConfig(): string {
  const dir = mkdtempSync(join(tmpdir(), "oc-id-fixture-config-"));
  const configPath = join(dir, "vitest.config.mjs");
  writeFileSync(
    configPath,
    `export default { test: { name: "release-eval-id-fixture", root: ${JSON.stringify(
      REPO_ROOT,
    )}, include: [${JSON.stringify(ID_FIXTURE_PATH)}] } };\n`,
  );
  return configPath;
}

const CASES_REQUIRED = [
  "Data Faithfulness Evals (Always-tier) quote-accuracy",
  "Routing Evals (Always-tier) stock-quote",
];

const EXPECTED_RAW: ExpectedCaseIds = {
  "router-live": ["alpha.json", "beta.json"],
  cases: [...CASES_REQUIRED, ...DEFAULT_OPTIONAL_CASE_IDS],
  product: ["product-a", "product-b"],
  "competitive:frozen": ["frozen-a", "frozen-b"],
};

function completionReport(suite: string, ids: string[], settings: Record<string, string> = {}) {
  const startedAt = new Date().toISOString();
  return {
    version: 1,
    suite,
    startedAt,
    finishedAt: new Date().toISOString(),
    cases: ids.map((id) => ({ id, status: "passed" })),
    exitCode: 0,
    settings,
  };
}

function vitestPayload(ids: string[], skipped: string[] = []) {
  const startedAt = Date.now();
  const assertionResults = [
    ...ids.map((fullName) => ({ fullName, status: "passed" })),
    ...skipped.map((fullName) => ({ fullName, status: "skipped" })),
  ];
  return {
    numTotalTests: assertionResults.length,
    numPassedTests: ids.length,
    numFailedTests: 0,
    numPendingTests: skipped.length,
    success: true,
    startTime: startedAt,
    testResults: [
      {
        name: "/repo/tests/evals/cases/faithfulness.eval.ts",
        status: "passed",
        startTime: startedAt,
        endTime: Date.now(),
        assertionResults,
      },
    ],
  };
}

function writeDefaultCompletion(request: ReleaseSuiteRequest): ReleaseSuiteExecution {
  if (request.suite === "cases") {
    writeFileSync(
      request.vitestJsonPath as string,
      JSON.stringify(vitestPayload(CASES_REQUIRED, DEFAULT_OPTIONAL_CASE_IDS)),
    );
  } else {
    writeFileSync(
      request.completionPath,
      JSON.stringify(completionReport(request.suite, EXPECTED_RAW[request.suite])),
    );
  }
  return { exitCode: 0, signal: null };
}

function makeHarness(
  overrides: Partial<ReleaseEvidenceDeps> = {},
  rootOverride?: string,
): { root: string; deps: ReleaseEvidenceDeps } {
  const root = rootOverride ?? mkdtempSync(join(tmpdir(), "oc-release-eval-evidence-"));
  const deps: ReleaseEvidenceDeps = {
    cwd: root,
    env: {},
    runDirParent: join(root, "validation-output", "release-evals"),
    runId: "run-1",
    now: () => new Date(),
    fingerprint: () => CANDIDATE,
    collectExpectedCaseIds: () => EXPECTED_RAW,
    executeSuite: (request) => writeDefaultCompletion(request),
    readTextFile: (path) => readFileSync(path, "utf-8"),
    writeTextAtomic: (path, content) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, "utf-8");
    },
    appendText: (path, content) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, { encoding: "utf-8", flag: "a" });
    },
    makeRunDir: (parent, runId) => {
      const dir = join(parent, runId);
      mkdirSync(dir, { recursive: true });
      return dir;
    },
    ...overrides,
  };
  return { root, deps };
}

function readAttempts(path: string): Array<Record<string, unknown>> {
  return readFileSync(path, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("canonical release environment", () => {
  it("pins every selector to a canonical value including real nullish defaults", () => {
    const pinned = canonicalReleaseEnv(new Date("2026-07-05T12:00:00.000Z"));
    expect(pinned.EVAL_TIER).toBe("");
    expect(pinned.PRODUCT_EVAL_LIMIT).toBe("");
    expect(pinned.OPENCANDLE_COMPETITIVE_PANEL).toBe("");
    expect(pinned.COMPETITIVE_PROMPT_SEED).toBe("2026-07-05");
    expect(pinned.PROMPT_POLICY_MANIFEST).toBe(
      "docs/internal/prompt-to-policy-migration-manifest.json",
    );
    expect(pinned.OPENCANDLE_MANUAL_RUN_SETTLE_GRACE_MS).toBe("90000");
    expect(pinned.OPENCANDLE_COMPETITIVE_AGENT_CWD).not.toBe("");
    expect(pinned.OPENCANDLE_COMPETITIVE_NO_CACHE).toBe("1");
    // Release runs use the default judge; a local judge-only override from
    // .env must not silently change the release report's grader.
    expect(pinned.OPENCANDLE_COMPETITIVE_JUDGE_PROVIDER).toBe("");
    expect(pinned.OPENCANDLE_COMPETITIVE_JUDGE_MODEL).toBe("");
  });

  it("clears inherited selectors but keeps credentials and model/provider choices", () => {
    const env = cleanReleaseEnv(
      {
        PATH: "/usr/bin",
        OPENAI_API_KEY: "secret",
        OPENCANDLE_ROUTER_PROVIDER: "google",
        OPENCANDLE_ROUTER_MODEL: "gemini",
        OPENCANDLE_COMPETITIVE_PROVIDER: "anthropic",
        OPENCANDLE_COMPETITIVE_MODEL: "claude",
        EVAL_TIER: "usually",
        PRODUCT_EVAL_LIMIT: "1",
        PROMPT_POLICY_MANIFEST: "/tmp/evil.json",
      },
      new Date("2026-07-05T12:00:00.000Z"),
    );

    expect(env.PATH).toBe("/usr/bin");
    expect(env.OPENAI_API_KEY).toBe("secret");
    expect(env.OPENCANDLE_ROUTER_PROVIDER).toBe("google");
    expect(env.OPENCANDLE_ROUTER_MODEL).toBe("gemini");
    expect(env.OPENCANDLE_COMPETITIVE_PROVIDER).toBe("anthropic");
    expect(env.OPENCANDLE_COMPETITIVE_MODEL).toBe("claude");
    expect(env.EVAL_TIER).toBe("");
    expect(env.PRODUCT_EVAL_LIMIT).toBe("");
    expect(env.PROMPT_POLICY_MANIFEST).toBe(
      "docs/internal/prompt-to-policy-migration-manifest.json",
    );
  });

  it("prevents a spawned loader from restoring .env filters while still loading credentials", {
    timeout: 180_000,
  }, () => {
    const dir = mkdtempSync(join(tmpdir(), "oc-release-dotenv-"));
    writeFileSync(
      join(dir, ".env"),
      [
        "EVAL_TIER=usually",
        "PRODUCT_EVAL_LIMIT=1",
        "PROMPT_POLICY_MANIFEST=/tmp/evil.json",
        "OPENCANDLE_ROUTER_PROVIDER=fromdotenv",
        "OPENAI_API_KEY=fromdotenv-credential",
      ].join("\n"),
    );
    const script = join(dir, "loader.ts");
    writeFileSync(
      script,
      [
        `import { loadEnv } from ${JSON.stringify(join(REPO_ROOT, "src/config.ts"))};`,
        `loadEnv(${JSON.stringify(join(dir, ".env"))});`,
        "console.log(JSON.stringify({",
        "  tier: process.env.EVAL_TIER,",
        "  limit: process.env.PRODUCT_EVAL_LIMIT,",
        "  manifest: process.env.PROMPT_POLICY_MANIFEST,",
        "  provider: process.env.OPENCANDLE_ROUTER_PROVIDER,",
        "  key: process.env.OPENAI_API_KEY,",
        "}));",
      ].join("\n"),
    );

    const env = cleanReleaseEnv(
      {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        OPENCANDLE_ROUTER_PROVIDER: "google",
      },
      new Date("2026-07-05T12:00:00.000Z"),
    );
    const result = spawnSync(join(REPO_ROOT, "node_modules", ".bin", "tsx"), [script], {
      cwd: REPO_ROOT,
      env,
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    const loaded = JSON.parse(result.stdout.trim());
    expect(loaded).toEqual({
      tier: "",
      limit: "",
      manifest: "docs/internal/prompt-to-policy-migration-manifest.json",
      provider: "google",
      key: "fromdotenv-credential",
    });
  });
});

describe("canonical vitest case ids", () => {
  it("maps list names and reporter fullNames to the same ids on a real fixture suite", {
    timeout: 180_000,
  }, () => {
    // The fixture lives outside every default project include; a minimal
    // explicit temp config is the only thing that runs it, so its empty
    // harness bodies never enter the default unit pass count.
    const configPath = writeIdFixtureConfig();
    const listed = listVitestCaseIds({ cwd: REPO_ROOT, env: process.env, timeoutMs: 120_000 }, [
      "list",
      "--config",
      configPath,
      "--json",
      "--staticParse=false",
    ]);
    const outputFile = join(mkdtempSync(join(tmpdir(), "oc-vitest-json-")), "report.json");
    const run = spawnSync(
      "vitest",
      ["run", "--config", configPath, "--reporter=json", `--outputFile=${outputFile}`],
      { cwd: REPO_ROOT, env: process.env, encoding: "utf-8" },
    );
    expect(run.status).toBe(0);
    const payload = JSON.parse(readFileSync(outputFile, "utf-8")) as {
      testResults?: Array<{ assertionResults?: Array<{ fullName?: string }> }>;
    };
    const reported = (payload.testResults ?? []).flatMap((file) =>
      (file.assertionResults ?? []).map((assertion) =>
        canonicalizeVitestCaseId(assertion.fullName ?? ""),
      ),
    );

    expect(listed.length).toBeGreaterThan(0);
    expect(reported.length).toBeGreaterThan(0);
    expect(new Set(listed)).toEqual(new Set(reported));
    expect(listed.some((id) => id.includes("parameter case alpha"))).toBe(true);
    expect(listed.every((id) => !id.includes(" > ") && !id.includes("%s"))).toBe(true);
  });

  it("keeps the real id fixture outside default unit discovery", () => {
    expect(ID_FIXTURE_PATH.startsWith("tests/unit/")).toBe(false);
    expect(ID_FIXTURE_PATH.endsWith(".test.ts")).toBe(false);
    // Only the explicit minimal config include runs the fixture.
    expect(readFileSync(writeIdFixtureConfig(), "utf-8")).toContain(ID_FIXTURE_PATH);
  });

  it("subtracts exact optional ids from independently collected expected sets", () => {
    const normalized = normalizeExpectedCaseIds(EXPECTED_RAW);
    expect(normalized.cases).toEqual(CASES_REQUIRED);
    expect(normalized.cases).toHaveLength(2);
  });

  it("matches the explicit optional policy to the real default-tier skipped placeholders", {
    timeout: 180_000,
  }, () => {
    const files = [
      "tests/evals/cases/debate.eval.ts",
      "tests/evals/cases/quality.eval.ts",
      "tests/evals/cases/saved-market-state.eval.ts",
      "tests/evals/cases/live-multi-turn-coreference.eval.ts",
    ];
    const outputFile = join(mkdtempSync(join(tmpdir(), "oc-placeholders-")), "report.json");
    // A caller may export usually-tier activation; the spawn must defuse it
    // itself and run the real child at default tier.
    const hostileAmbient: NodeJS.ProcessEnv = {
      ...process.env,
      EVAL_TIER: "usually",
      OPENCANDLE_LIVE_MULTI_TURN_EVAL: "1",
      OPENCANDLE_RUN_KNOWN_FAIL_EVALS: "1",
      OPENCANDLE_EVAL_KNOWN_FAIL_E2: "1",
    };
    const run = spawnSync(
      "vitest",
      ["run", "--project", "evals", ...files, "--reporter=json", `--outputFile=${outputFile}`],
      {
        cwd: REPO_ROOT,
        env: defaultTierPlaceholderEnv(hostileAmbient),
        encoding: "utf-8",
        timeout: 180_000,
      },
    );
    expect(run.status).toBe(0);
    const payload = JSON.parse(readFileSync(outputFile, "utf-8")) as {
      testResults?: Array<{ assertionResults?: Array<{ fullName?: string; status?: string }> }>;
    };
    const skipped = (payload.testResults ?? []).flatMap((file) =>
      (file.assertionResults ?? [])
        .filter((assertion) => assertion.status === "skipped")
        .map((assertion) => canonicalizeVitestCaseId(assertion.fullName ?? "")),
    );

    // Default tier skips these without executing any live case.
    expect(new Set(skipped)).toEqual(new Set(DEFAULT_OPTIONAL_CASE_IDS));
  });
});

describe("releaseArgumentProblem", () => {
  it("rejects unsupported release arguments instead of ignoring them", () => {
    expect(releaseArgumentProblem([])).toBeNull();
    expect(releaseArgumentProblem(["--tier", "usually"])).toContain("Unsupported release argument");
  });
});

describe("release eval evidence orchestration", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes complete evidence with required cases only and preserves optional skips", () => {
    const { deps } = makeHarness();
    const outcome = runReleaseWithEvidence(deps);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.evidencePath).not.toBeNull();
    const evidence = JSON.parse(readFileSync(outcome.evidencePath as string, "utf-8"));
    expect(Object.keys(evidence.suites).sort()).toEqual(
      ["cases", "competitive:frozen", "product", "router-live"].sort(),
    );
    expect(evidence.suites.cases.cases.map((entry: { id: string }) => entry.id)).toEqual(
      CASES_REQUIRED,
    );
    expect(readAttempts(outcome.attemptsPath)).toHaveLength(4);

    const summary = JSON.parse(readFileSync(outcome.summaryPath, "utf-8"));
    expect(summary.optionalSkips.map((skip: { id: string }) => skip.id)).toEqual(
      DEFAULT_OPTIONAL_CASE_IDS,
    );
  });

  it("merges resolved runner env so competitive:frozen is actually frozen", () => {
    const seenPanel = new Map<string, string | undefined>();
    const seenNoCache = new Map<string, string | undefined>();
    const { deps } = makeHarness({
      executeSuite: (request) => {
        seenPanel.set(request.suite, request.env.OPENCANDLE_COMPETITIVE_PANEL);
        seenNoCache.set(request.suite, request.env.OPENCANDLE_COMPETITIVE_NO_CACHE);
        return writeDefaultCompletion(request);
      },
    });
    runReleaseWithEvidence(deps);

    expect(seenPanel.get("competitive:frozen")).toBe("frozen");
    expect(seenPanel.get("cases")).toBe("");
    // Release runs never reuse cached competitor answers or prompt metadata.
    expect(seenNoCache.get("competitive:frozen")).toBe("1");
    expect(seenNoCache.get("cases")).toBe("1");
  });

  it("records disabled competitive cache in the linked run summary", () => {
    const { deps } = makeHarness();
    const outcome = runReleaseWithEvidence(deps);

    expect(outcome.exitCode).toBe(0);
    const summary = JSON.parse(readFileSync(outcome.summaryPath, "utf-8"));
    expect(summary.competitiveCache).toBe("disabled");
  });

  it("refuses to run when independently collected expected ids are empty", () => {
    const executeSuite = vi.fn(writeDefaultCompletion);
    const { deps } = makeHarness({
      collectExpectedCaseIds: () => ({ ...EXPECTED_RAW, cases: [] }),
      executeSuite,
    });
    const outcome = runReleaseWithEvidence(deps);

    expect(outcome.exitCode).toBe(1);
    expect(executeSuite).not.toHaveBeenCalled();
    expect(outcome.evidencePath).toBeNull();
  });

  it("fails a child crash or signal even when a report is present", () => {
    const { deps } = makeHarness({
      executeSuite: (request) =>
        request.suite === "product"
          ? { exitCode: null, signal: "SIGKILL" }
          : writeDefaultCompletion(request),
    });
    const outcome = runReleaseWithEvidence(deps);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.evidencePath).toBeNull();
    expect(outcome.problems.some((problem) => problem.includes("SIGKILL"))).toBe(true);
    const incomplete = JSON.parse(readFileSync(outcome.incompletePath as string, "utf-8"));
    expect(incomplete.attempts.find((a: { suite: string }) => a.suite === "product").verdict).toBe(
      "failed",
    );
  });

  it("fails a child timeout even when no signal is surfaced", () => {
    const { deps } = makeHarness({
      executeSuite: (request) =>
        request.suite === "router-live"
          ? { exitCode: null, signal: null, errorMessage: "spawnSync vitest ETIMEDOUT" }
          : writeDefaultCompletion(request),
    });
    const outcome = runReleaseWithEvidence(deps);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.problems.some((problem) => problem.includes("ETIMEDOUT"))).toBe(true);
  });

  it("blocks a zero-exit child that writes no completion report", () => {
    const { deps } = makeHarness({
      executeSuite: (request) =>
        request.suite === "competitive:frozen"
          ? { exitCode: 0, signal: null }
          : writeDefaultCompletion(request),
    });
    const outcome = runReleaseWithEvidence(deps);

    expect(outcome.exitCode).toBe(1);
    expect(
      outcome.problems.some((problem) =>
        problem.includes("competitive:frozen completion report is absent"),
      ),
    ).toBe(true);
  });

  it("keeps the first missing-report attempt blocked and preserved across a green rerun", () => {
    const root = mkdtempSync(join(tmpdir(), "oc-release-rerun-"));
    const parent = join(root, "validation-output", "release-evals");
    const first = makeHarness(
      {
        runId: "run-first",
        runDirParent: parent,
        executeSuite: (request) =>
          request.suite === "cases"
            ? { exitCode: 0, signal: null }
            : writeDefaultCompletion(request),
      },
      root,
    );
    const firstOutcome = runReleaseWithEvidence(first.deps);
    expect(firstOutcome.exitCode).toBe(1);
    expect(existsSync(join(firstOutcome.runDir, "release-evidence.json"))).toBe(false);

    const second = makeHarness({ runId: "run-second", runDirParent: parent }, root);
    const secondOutcome = runReleaseWithEvidence(second.deps);
    expect(secondOutcome.exitCode).toBe(0);
    expect(secondOutcome.runDir).not.toBe(firstOutcome.runDir);

    // The blocked first attempt is untouched by the later green run.
    expect(existsSync(join(firstOutcome.runDir, "release-eval-incomplete.json"))).toBe(true);
    const firstAttempts = readAttempts(firstOutcome.attemptsPath);
    expect(firstAttempts.find((a) => a.suite === "cases")?.verdict).toBe("failed");
    expect(readAttempts(secondOutcome.attemptsPath).find((a) => a.suite === "cases")?.verdict).toBe(
      "passed",
    );
  });

  it("rejects a stale reused completion report outside the attempt window", () => {
    const runDir = join(tmpdir(), `oc-stale-${process.pid}-${Date.now()}`);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "competitive-frozen.completion.json"),
      JSON.stringify({
        version: 1,
        suite: "competitive:frozen",
        startedAt: "2000-01-01T00:00:00.000Z",
        finishedAt: "2000-01-01T00:00:01.000Z",
        cases: EXPECTED_RAW["competitive:frozen"].map((id) => ({ id, status: "passed" })),
        exitCode: 0,
        settings: {},
      }),
    );
    const { deps } = makeHarness({
      makeRunDir: () => {
        mkdirSync(runDir, { recursive: true });
        return runDir;
      },
      executeSuite: (request) =>
        request.suite === "competitive:frozen"
          ? { exitCode: 0, signal: null }
          : writeDefaultCompletion(request),
    });
    const outcome = runReleaseWithEvidence(deps);

    expect(outcome.exitCode).toBe(1);
    expect(
      outcome.problems.some((problem) => problem.includes("outside its own attempt window")),
    ).toBe(true);
  });

  it("fails when the candidate fingerprint changes during the run", () => {
    let calls = 0;
    const { deps } = makeHarness({
      fingerprint: () => {
        calls += 1;
        return calls === 1 ? CANDIDATE : { ...CANDIDATE, sourceDigest: "sha256:changed" };
      },
    });
    const outcome = runReleaseWithEvidence(deps);

    expect(outcome.exitCode).toBe(1);
    expect(
      outcome.problems.some((problem) =>
        problem.includes("fingerprint changed during the release"),
      ),
    ).toBe(true);
  });

  it("rejects a partial case selection that omits an independently collected id", () => {
    const { deps } = makeHarness({
      executeSuite: (request) => {
        if (request.suite !== "cases") return writeDefaultCompletion(request);
        writeFileSync(
          request.vitestJsonPath as string,
          JSON.stringify(vitestPayload([CASES_REQUIRED[0]], DEFAULT_OPTIONAL_CASE_IDS)),
        );
        return { exitCode: 0, signal: null };
      },
    });
    const outcome = runReleaseWithEvidence(deps);

    expect(outcome.exitCode).toBe(1);
    expect(
      outcome.problems.some((problem) =>
        problem.includes(`missing expected case id "${CASES_REQUIRED[1]}"`),
      ),
    ).toBe(true);
  });

  it("uses validated report settings as primary per-suite metadata with env fallback", () => {
    const { deps } = makeHarness({
      env: {
        OPENCANDLE_ROUTER_PROVIDER: "google",
        OPENCANDLE_ROUTER_MODEL: "gemini",
        OPENCANDLE_COMPETITIVE_PROVIDER: "anthropic",
        OPENCANDLE_COMPETITIVE_MODEL: "claude",
      },
      executeSuite: (request) => {
        if (request.suite !== "competitive:frozen") return writeDefaultCompletion(request);
        writeFileSync(
          request.completionPath,
          JSON.stringify(
            completionReport(request.suite, EXPECTED_RAW[request.suite], {
              provider: "openai",
              model: "gpt-5",
              mode: "frozen",
              seed: "2026-07-05",
            }),
          ),
        );
        return { exitCode: 0, signal: null };
      },
    });
    const outcome = runReleaseWithEvidence(deps);

    expect(outcome.exitCode).toBe(0);
    const summary = JSON.parse(readFileSync(outcome.summaryPath, "utf-8"));
    // Competitive recorded what actually ran.
    expect(summary.suiteSettings["competitive:frozen"]).toEqual({
      provider: "openai",
      model: "gpt-5",
      mode: "frozen",
      seed: "2026-07-05",
    });
    // Router has no completion settings, so the operator selection is used.
    expect(summary.suiteSettings["router-live"]).toEqual({
      provider: "google",
      model: "gemini",
    });
    const evidence = JSON.parse(readFileSync(outcome.evidencePath as string, "utf-8"));
    expect(evidence.model).toBeUndefined();
  });

  it("carries real writer competitor skip metadata into the linked summary and evidence", () => {
    const { deps } = makeHarness({
      executeSuite: (request) => {
        const result = writeDefaultCompletion(request);
        if (request.suite === "competitive:frozen") {
          writeCompetitorSkipMetadata(request.completionPath, "competitive:frozen", [
            { id: "gemini", reason: "no credentials" },
          ]);
        }
        return result;
      },
    });
    const outcome = runReleaseWithEvidence(deps);

    expect(outcome.exitCode).toBe(0);
    const summary = JSON.parse(readFileSync(outcome.summaryPath, "utf-8"));
    expect(summary.competitorsKnown).toBe(true);
    expect(summary.competitors).toEqual([{ id: "gemini", reason: "no credentials" }]);
    const evidence = JSON.parse(readFileSync(outcome.evidencePath as string, "utf-8"));
    expect(evidence.competitors).toEqual([{ id: "gemini", reason: "no credentials" }]);
  });

  it("marks missing competitor metadata as unknown rather than none", () => {
    const { deps } = makeHarness();
    const outcome = runReleaseWithEvidence(deps);

    expect(outcome.exitCode).toBe(0);
    const summary = JSON.parse(readFileSync(outcome.summaryPath, "utf-8"));
    expect(summary.competitorsKnown).toBe(false);
    expect(summary.competitors).toBeNull();
    const evidence = JSON.parse(readFileSync(outcome.evidencePath as string, "utf-8"));
    expect(evidence.competitors).toBeUndefined();
  });

  it("blocks the release when competitor metadata is malformed", () => {
    const { deps } = makeHarness({
      executeSuite: (request) => {
        const result = writeDefaultCompletion(request);
        if (request.suite === "competitive:frozen") {
          writeFileSync(`${request.completionPath}.competitors.json`, "{not json");
        }
        return result;
      },
    });
    const outcome = runReleaseWithEvidence(deps);

    expect(outcome.exitCode).toBe(1);
    expect(
      outcome.problems.some((problem) => problem.includes("competitor skip metadata is invalid")),
    ).toBe(true);
  });
});

describe("candidate-scoped v2 release evidence", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const STARTUP = "release-eval-startup.json";

  it("persists the candidate-scoped startup manifest before collection and children", () => {
    const events: string[] = [];
    let manifestAtCollection: Record<string, unknown> | null = null;
    let manifestAtChild: Record<string, unknown> | null = null;
    const { root, deps } = makeHarness({
      collectExpectedCaseIds: (context) => {
        events.push("collect");
        manifestAtCollection = JSON.parse(
          readFileSync(join(context.runDir, STARTUP), "utf-8"),
        ) as Record<string, unknown>;
        return EXPECTED_RAW;
      },
      executeSuite: (request) => {
        events.push(`suite:${request.suite}`);
        if (manifestAtChild === null) {
          manifestAtChild = JSON.parse(
            readFileSync(join(dirname(request.completionPath), STARTUP), "utf-8"),
          ) as Record<string, unknown>;
        }
        return writeDefaultCompletion(request);
      },
    });

    const outcome = runReleaseWithEvidence(deps);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.runDir).toBe(
      join(root, "validation-output", "release-evals", "v2", CANDIDATE.commit, "run-1"),
    );
    expect(manifestAtCollection).not.toBeNull();
    expect(manifestAtCollection).toMatchObject({
      format: "release-eval-evidence-v2",
      runId: "run-1",
      candidate: CANDIDATE,
    });
    expect(manifestAtChild).toEqual(manifestAtCollection);
    expect(events[0]).toBe("collect");
    expect(events.slice(1)).toEqual([
      "suite:router-live",
      "suite:cases",
      "suite:product",
      "suite:competitive:frozen",
    ]);
  });

  it("fails fast after the first failed suite and marks later suites not run", () => {
    const calls: string[] = [];
    const { deps } = makeHarness({
      executeSuite: (request) => {
        calls.push(request.suite);
        if (request.suite === "cases") return { exitCode: 1, signal: null };
        return writeDefaultCompletion(request);
      },
    });

    const outcome = runReleaseWithEvidence(deps);

    expect(outcome.exitCode).toBe(1);
    expect(calls).toEqual(["router-live", "cases"]);
    const incomplete = JSON.parse(readFileSync(outcome.incompletePath as string, "utf-8"));
    expect(incomplete.notRunSuites).toEqual(["product", "competitive:frozen"]);
    const summary = JSON.parse(readFileSync(outcome.summaryPath, "utf-8"));
    expect(summary.notRunSuites).toEqual(["product", "competitive:frozen"]);
    expect(summary.candidate).toEqual(CANDIDATE);
  });

  it("turns an executeSuite throw into a failed attempt and still finalizes", () => {
    const { deps } = makeHarness({
      executeSuite: (request) => {
        if (request.suite === "router-live") throw new Error("spawn boom");
        return writeDefaultCompletion(request);
      },
    });

    const outcome = runReleaseWithEvidence(deps);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.incompletePath).not.toBeNull();
    expect(outcome.problems.some((problem) => problem.includes("spawn boom"))).toBe(true);
    const attempts = readAttempts(outcome.attemptsPath);
    expect(attempts[0]).toMatchObject({ suite: "router-live", verdict: "failed" });
    expect(JSON.parse(readFileSync(outcome.summaryPath, "utf-8")).candidate).toEqual(CANDIDATE);
  });

  it("writes run and candidate identity into every attempt journal record", () => {
    const { deps } = makeHarness();
    const outcome = runReleaseWithEvidence(deps);

    const attempts = readAttempts(outcome.attemptsPath);
    expect(attempts).toHaveLength(4);
    for (const attempt of attempts) {
      expect(attempt.runId).toBe("run-1");
      expect(attempt.candidate).toEqual(CANDIDATE);
    }
  });
});

describe("real expected-case collection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("collects canonical eval ids from a real vitest list without running the suite", {
    timeout: 180_000,
  }, () => {
    const expected = collectRealExpectedCaseIds({
      cwd: REPO_ROOT,
      env: cleanReleaseEnv(process.env, new Date("2026-07-05T12:00:00.000Z")),
      runDir: join(tmpdir(), "oc-collect"),
      timeoutMs: 180_000,
    });

    expect(expected.cases.length).toBeGreaterThan(0);
    expect(expected.cases.every((id) => !id.includes(" > ") && !id.includes("%s"))).toBe(true);
    const normalized = normalizeExpectedCaseIds(expected);
    // Optional default-tier placeholders are excluded from the required set.
    expect(normalized.cases.some((id) => DEFAULT_OPTIONAL_CASE_IDS.includes(id))).toBe(false);
    expect(expected["competitive:frozen"]).toEqual([
      "frozen-portfolio-review-not-builder",
      "frozen-covered-call-dte-preservation",
      "frozen-protective-put-not-bullish-call",
      "frozen-unknown-ticker-no-dead-end",
      "frozen-hedge-sizing-with-share-count",
    ]);
  });
});

describe("fresh release without credentials", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fails honestly and never writes evidence when every runner lacks credentials", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps } = makeHarness({
      // Simulates the no-key live environment: children fail before writing reports.
      executeSuite: () => ({
        exitCode: 1,
        signal: null,
        errorMessage: "no API key configured",
      }),
    });
    const outcome = runReleaseWithEvidence(deps);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.evidencePath).toBeNull();
    expect(outcome.incompletePath).not.toBeNull();
    expect(outcome.problems.length).toBeGreaterThan(0);
  });
});
