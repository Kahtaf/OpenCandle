/**
 * Release eval completion evidence orchestration.
 *
 * `npm run eval -- release` runs the required eval cadence once per suite,
 * collects an independently verified completion record for every required
 * runner, and assembles a redacted release-evidence record that is validated
 * against a clean candidate fingerprint.
 *
 * A completion report is evidence, never authority: a reported case id only
 * counts when it matches a canonical id collected independently before the
 * run, and a reported timestamp only counts inside the attempt window this
 * orchestrator observed. There is deliberately no retry-until-green: one
 * invocation records exactly one attempt per suite, and a diagnostic rerun is
 * a separate invocation with its own preserved run directory.
 */

import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fingerprintCandidate, validateReleaseEvidence } from "../../scripts/release-evidence.mjs";
import {
  competitorSkipMetadataPath,
  parseCompetitorSkipMetadata,
} from "../evals/competitive-completion.js";
import {
  DEFAULT_COMPETITIVE_JUDGE,
  FROZEN_COMPETITIVE_PANEL,
} from "../evals/competitive-finance.js";
import {
  type CompletionReport,
  convertVitestJsonReport,
  type VitestJsonReportPayload,
  validateCompletionReport,
} from "../evals/completion-report.js";
import { PRODUCT_EVAL_CASES } from "../evals/product/cases.js";
import {
  RELEASE_SEQUENCE,
  type ResolvedEvalCommand,
  resolveEvalCommand,
} from "./run-evals-table.js";

export const RELEASE_SUITE_IDS = RELEASE_SEQUENCE;
export type ReleaseSuiteId = (typeof RELEASE_SEQUENCE)[number];

/**
 * Exact canonical ids of the cases the default-tier release run is allowed to
 * skip. Every entry was observed from a real default-tier Vitest JSON run, not
 * inferred from a status/name pattern. The live multi-turn file contributes two
 * skipped cases in default tier. Anything else skipped is a required failure.
 */
export const DEFAULT_OPTIONAL_CASE_IDS: readonly string[] = [
  "Debate Evals (Usually-tier) skipped — run with EVAL_TIER=usually",
  "Quality Evals (Usually-tier) skipped — run with EVAL_TIER=usually",
  "Saved Market-State Fidelity Evals (Known-fail E2) KNOWN-FAIL E2: opt-in with EVAL_TIER=usually OPENCANDLE_EVAL_KNOWN_FAIL_E2=1",
  "E1 live multi-turn coreference eval KNOWN-FAIL E1: resolves prior-turn price coreference and saved-state holding references in router trace evidence",
  "E1 live multi-turn coreference eval skipped — run with EVAL_TIER=usually OPENCANDLE_LIVE_MULTI_TURN_EVAL=1 OPENCANDLE_RUN_KNOWN_FAIL_EVALS=1 for the known-fail live E1 case",
];

const DEFAULT_LIST_TIMEOUT_MS = 300_000;
const DEFAULT_SUITE_TIMEOUT_MS = 7_200_000;
const DEFAULT_TIMING_SLACK_MS = 1_000;

/**
 * Explicit producer/collector durability format for candidate-scoped evidence.
 * This is a namespace/record format, not the semantic evidence payload: the
 * `release-evidence.json` payload stays schema v1 until its meaning changes.
 */
export const RELEASE_EVAL_FORMAT_V2 = "release-eval-evidence-v2";
export const RELEASE_EVAL_STARTUP_FILENAME = "release-eval-startup.json";

// Model/provider selections the operator may keep. Everything else in the
// selector families below is cleared and replaced by the canonical release
// value, so a local .env cannot narrow the release coverage.
const ALLOWED_MODEL_ENV = new Set([
  "OPENCANDLE_ROUTER_PROVIDER",
  "OPENCANDLE_ROUTER_MODEL",
  "OPENCANDLE_COMPETITIVE_PROVIDER",
  "OPENCANDLE_COMPETITIVE_MODEL",
  "OPENCANDLE_COMPETITIVE_CODEX_MODEL",
  "OPENCANDLE_COMPETITIVE_GEMINI_AGENT",
  "OPENCANDLE_COMPETITIVE_GEMINI_MODEL",
  "OPENCANDLE_EVAL_MODEL",
  "OPENCANDLE_EVAL_MODEL_PROVIDER",
]);
const SELECTOR_PREFIXES = [
  "PRODUCT_EVAL_",
  "COMPETITIVE_PROMPT_",
  "OPENCANDLE_COMPETITIVE_",
  "OPENCANDLE_ROUTER_",
  "OPENCANDLE_EVAL_",
];
const SELECTOR_EXACT = new Set([
  "EVAL_TIER",
  "PROMPT_POLICY_MANIFEST",
  "OPENCANDLE_MANUAL_RUN_SETTLE_GRACE_MS",
]);

function isSelectorKey(key: string): boolean {
  if (ALLOWED_MODEL_ENV.has(key)) return false;
  if (SELECTOR_EXACT.has(key)) return true;
  return SELECTOR_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * Canonical values for every selector the runners read. Empty string means
 * "feature off": the runners treat it as falsy, and because the value is
 * defined, the child's `loadEnv()` will not restore a `.env` override.
 * Nullish-defaulted vars get their real default instead of an empty value.
 */
export function canonicalReleaseEnv(now: Date = new Date()): Record<string, string> {
  return {
    EVAL_TIER: "",
    OPENCANDLE_LIVE_MULTI_TURN_EVAL: "",
    OPENCANDLE_RUN_KNOWN_FAIL_EVALS: "",
    OPENCANDLE_EVAL_KNOWN_FAIL_E2: "",
    PRODUCT_EVAL_CASE: "",
    PRODUCT_EVAL_FAMILY: "",
    PRODUCT_EVAL_INCLUDE_OPT_IN: "",
    PRODUCT_EVAL_LIMIT: "",
    COMPETITIVE_PROMPT_COUNT: "",
    // Nullish-defaulted by the competitive runner; pin the runner's real default.
    COMPETITIVE_PROMPT_SEED: now.toISOString().slice(0, 10),
    OPENCANDLE_COMPETITIVE_PANEL: "",
    OPENCANDLE_COMPETITIVE_PROMPT: "",
    OPENCANDLE_COMPETITIVE_PROMPT_ID: "",
    OPENCANDLE_COMPETITIVE_PROMPT_TOPIC: "",
    OPENCANDLE_COMPETITIVE_PROMPT_COMPLEXITY: "",
    OPENCANDLE_COMPETITIVE_PROMPT_FOCUS: "",
    OPENCANDLE_COMPETITIVE_SEED_STATE: "",
    OPENCANDLE_COMPETITIVE_REQUIRE_ALL: "",
    OPENCANDLE_COMPETITIVE_PREFLIGHT: "",
    OPENCANDLE_COMPETITIVE_PREFLIGHT_TIMEOUT_MS: "",
    OPENCANDLE_COMPETITIVE_AGENT_CWD: join(tmpdir(), "oc-competitive-agents"),
    // Release runs must not reuse cached competitor answers or prompt metadata.
    OPENCANDLE_COMPETITIVE_NO_CACHE: "1",
    OPENCANDLE_COMPETITIVE_CACHE: "",
    OPENCANDLE_COMPETITIVE_REUSE_CACHE: "",
    // Pin the calibrated judge by name so the release record states its
    // grader and a local judge override cannot leak in.
    OPENCANDLE_COMPETITIVE_JUDGE_PROVIDER: DEFAULT_COMPETITIVE_JUDGE.provider,
    OPENCANDLE_COMPETITIVE_JUDGE_MODEL: DEFAULT_COMPETITIVE_JUDGE.model,
    // Nullish-defaulted path; keep the real default so it still resolves.
    PROMPT_POLICY_MANIFEST: "docs/internal/prompt-to-policy-migration-manifest.json",
    OPENCANDLE_MANUAL_RUN_SETTLE_GRACE_MS: "90000",
    OPENCANDLE_EVAL_COMPLETION_PATH: "",
  };
}

/** Strip inherited selectors, then pin every canonical release value. */
export function cleanReleaseEnv(
  base: NodeJS.ProcessEnv,
  now: Date = new Date(),
): NodeJS.ProcessEnv {
  const cleaned: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined || isSelectorKey(key)) continue;
    cleaned[key] = value;
  }
  return { ...cleaned, ...canonicalReleaseEnv(now) };
}

export interface CandidateIdentity {
  commit: string;
  sourceDigest: string;
  lockDigest: string;
  policyDigest: string;
}

export type ExpectedCaseIds = Record<ReleaseSuiteId, string[]>;

export interface ExpectedCaseIdContext {
  cwd: string;
  env: NodeJS.ProcessEnv;
  runDir: string;
  timeoutMs: number;
}

export interface ReleaseSuiteRequest {
  suite: ReleaseSuiteId;
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  completionPath: string;
  vitestJsonPath: string | null;
  timeoutMs: number;
}

export interface ReleaseSuiteExecution {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  errorMessage?: string;
}

export interface ReleaseEvidenceDeps {
  cwd: string;
  env: NodeJS.ProcessEnv;
  runDirParent: string;
  runId?: string;
  now(): Date;
  fingerprint(root: string): CandidateIdentity;
  collectExpectedCaseIds(context: ExpectedCaseIdContext): ExpectedCaseIds;
  executeSuite(request: ReleaseSuiteRequest): ReleaseSuiteExecution;
  readTextFile(path: string): string;
  writeTextAtomic(path: string, content: string): void;
  appendText(path: string, content: string): void;
  makeRunDir(parent: string, runId: string): string;
  createRunId?: (now: Date) => string;
  optionalCaseIds?: readonly string[];
  timingSlackMs?: number;
  listTimeoutMs?: number;
  suiteTimeoutMs?: number;
}

export interface ReleaseEvidenceOutcome {
  exitCode: number;
  runId: string;
  runDir: string;
  evidencePath: string | null;
  attemptsPath: string;
  incompletePath: string | null;
  summaryPath: string;
  problems: string[];
  startedAt: string;
  finishedAt: string;
}

interface AttemptRecord {
  format: typeof RELEASE_EVAL_FORMAT_V2;
  runId: string;
  candidate: CandidateIdentity | null;
  suite: ReleaseSuiteId;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  error: string | null;
  verdict: "passed" | "failed";
  startedAt: string;
  finishedAt: string;
  completionPath: string;
  vitestJsonPath: string | null;
}

export function buildReleaseRunId(now: Date, random: () => number = Math.random): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return `${stamp}-${process.pid}-${random().toString(36).slice(2, 8)}`;
}

export function releaseArgumentProblem(argv: readonly string[]): string | null {
  if (argv.length === 0) return null;
  return `Unsupported release argument(s): ${argv.join(" ")}. "npm run eval -- release" takes no arguments.`;
}

/** Vitest `list` joins suite titles with " > "; the JSON reporter joins with a space. */
export function canonicalizeVitestCaseId(raw: string): string {
  return raw
    .replace(/\s+>\s+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeExpectedCaseIds(
  expected: ExpectedCaseIds,
  optionalCaseIds: readonly string[] = DEFAULT_OPTIONAL_CASE_IDS,
): ExpectedCaseIds {
  const optional = new Set(optionalCaseIds);
  const normalized = {} as ExpectedCaseIds;
  for (const suite of RELEASE_SUITE_IDS) {
    const raw = expected?.[suite];
    if (!Array.isArray(raw)) {
      throw new Error(`expected case ids for suite "${suite}" must be an array`);
    }
    const required = raw
      .map((id) => canonicalizeVitestCaseId(id))
      .filter((id) => !optional.has(id));
    const seen = new Set<string>();
    for (const id of required) {
      if (id === "" || seen.has(id)) {
        throw new Error(`expected case ids for suite "${suite}" must be unique non-empty strings`);
      }
      seen.add(id);
    }
    if (required.length === 0) {
      throw new Error(`expected case ids for suite "${suite}" must not be empty`);
    }
    normalized[suite] = required;
  }
  return normalized;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildSuiteRequest(
  suite: ReleaseSuiteId,
  env: NodeJS.ProcessEnv,
  cwd: string,
  runDir: string,
  timeoutMs: number,
): ReleaseSuiteRequest {
  const resolved: ResolvedEvalCommand = resolveEvalCommand(suite, []);
  const completionPath = join(runDir, `${suite.replace(/[^a-z0-9]+/gi, "-")}.completion.json`);
  const mergedEnv = { ...env, ...resolved.env, OPENCANDLE_EVAL_COMPLETION_PATH: completionPath };
  if (suite === "cases") {
    const vitestJsonPath = join(runDir, "cases.vitest.json");
    return {
      suite,
      command: resolved.command,
      args: [
        ...resolved.args,
        "--reporter=default",
        "--reporter=json",
        `--outputFile=${vitestJsonPath}`,
      ],
      env: mergedEnv,
      cwd,
      completionPath,
      vitestJsonPath,
      timeoutMs,
    };
  }
  return {
    suite,
    command: resolved.command,
    args: [...resolved.args],
    env: mergedEnv,
    cwd,
    completionPath,
    vitestJsonPath: null,
    timeoutMs,
  };
}

function checkReportIdentity(
  report: CompletionReport,
  suite: ReleaseSuiteId,
  execution: ReleaseSuiteExecution,
  window: { startedAtMs: number; finishedAtMs: number },
  slackMs: number,
): string[] {
  const problems: string[] = [];
  if (report.suite !== suite) {
    problems.push(`${suite} completion report names suite "${report.suite}"`);
  }
  if (report.exitCode !== execution.exitCode) {
    problems.push(
      `${suite} completion report exitCode ${report.exitCode} does not match child exit ${String(execution.exitCode)}`,
    );
  }
  const startedAtMs = parseTimestamp(report.startedAt);
  const finishedAtMs = parseTimestamp(report.finishedAt);
  if (startedAtMs === null || finishedAtMs === null) {
    problems.push(`${suite} completion report has unparseable timestamps`);
    return problems;
  }
  if (finishedAtMs < startedAtMs) {
    problems.push(`${suite} completion report finishes before it starts`);
  }
  const lower = window.startedAtMs - slackMs;
  const upper = window.finishedAtMs + slackMs;
  if (startedAtMs < lower || startedAtMs > upper || finishedAtMs < lower || finishedAtMs > upper) {
    problems.push(`${suite} completion report timestamps fall outside its own attempt window`);
  }
  return problems;
}

interface CompletionReadResult {
  report?: CompletionReport;
  problems: string[];
}

function readCompletion(
  request: ReleaseSuiteRequest,
  execution: ReleaseSuiteExecution,
  window: { startedAtMs: number; finishedAtMs: number },
  optionalCaseIds: readonly string[],
  slackMs: number,
  readTextFile: (path: string) => string,
): CompletionReadResult {
  const problems: string[] = [];
  try {
    const raw = readTextFile(request.vitestJsonPath ?? request.completionPath);
    const report: CompletionReport =
      request.suite === "cases"
        ? convertVitestJsonReport(JSON.parse(raw) as VitestJsonReportPayload, {
            suite: request.suite,
            optionalCaseIds,
          })
        : (JSON.parse(raw) as CompletionReport);
    validateCompletionReport(report, { optionalCaseIds });
    problems.push(...checkReportIdentity(report, request.suite, execution, window, slackMs));
    return { report, problems };
  } catch (error) {
    problems.push(
      `${request.suite} completion report is absent, truncated, or invalid: ${errorMessage(error)}`,
    );
    return { problems };
  }
}

const SUITE_MODEL_ENV: Record<ReleaseSuiteId, [string, string]> = {
  "router-live": ["OPENCANDLE_ROUTER_PROVIDER", "OPENCANDLE_ROUTER_MODEL"],
  cases: ["OPENCANDLE_EVAL_MODEL_PROVIDER", "OPENCANDLE_EVAL_MODEL"],
  product: ["OPENCANDLE_EVAL_MODEL_PROVIDER", "OPENCANDLE_EVAL_MODEL"],
  "competitive:frozen": ["OPENCANDLE_COMPETITIVE_PROVIDER", "OPENCANDLE_COMPETITIVE_MODEL"],
};

/** Env-derived fallback when a completion report carries no settings. */
function envSuiteSettings(suite: ReleaseSuiteId, env: NodeJS.ProcessEnv): Record<string, string> {
  const [providerKey, modelKey] = SUITE_MODEL_ENV[suite];
  const settings: Record<string, string> = {};
  const provider = env[providerKey];
  const model = env[modelKey];
  if (typeof provider === "string" && provider.trim() !== "") settings.provider = provider;
  if (typeof model === "string" && model.trim() !== "") settings.model = model;
  return settings;
}

/**
 * Actual per-suite metadata: the validated completion report settings are
 * primary (the runner recorded what actually ran), with the operator's model
 * selection as fallback for suites whose report carries no settings.
 */
function suiteSettings(
  suite: ReleaseSuiteId,
  reportSettings: Record<string, string> | undefined,
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  if (reportSettings && Object.keys(reportSettings).length > 0) return { ...reportSettings };
  return envSuiteSettings(suite, env);
}

interface CompetitorMetadataRead {
  known: boolean;
  skips: Array<{ id: string; reason: string }>;
  problem: string | null;
}

/**
 * Read the same-run competitor skip metadata written beside the completion
 * report. Absent means unknown (never "none"); malformed means a blocked run.
 */
function readCompetitorMetadata(
  completionPath: string,
  readTextFile: (path: string) => string,
): CompetitorMetadataRead {
  let raw: string;
  try {
    raw = readTextFile(competitorSkipMetadataPath(completionPath));
  } catch {
    return { known: false, skips: [], problem: null };
  }
  try {
    const parsed = parseCompetitorSkipMetadata(JSON.parse(raw), "competitive:frozen");
    if (parsed === null) throw new Error("unsupported or malformed metadata shape");
    return { known: true, skips: parsed, problem: null };
  } catch (error) {
    return {
      known: false,
      skips: [],
      problem: `competitive:frozen competitor skip metadata is invalid: ${errorMessage(error)}`,
    };
  }
}

function sameCandidate(a: CandidateIdentity, b: CandidateIdentity): boolean {
  return (
    a.commit === b.commit &&
    a.sourceDigest === b.sourceDigest &&
    a.lockDigest === b.lockDigest &&
    a.policyDigest === b.policyDigest
  );
}

export function runReleaseWithEvidence(deps: ReleaseEvidenceDeps): ReleaseEvidenceOutcome {
  const startedAt = deps.now().toISOString();
  const runId = deps.runId ?? (deps.createRunId ?? buildReleaseRunId)(deps.now());
  const optionalCaseIds = deps.optionalCaseIds ?? DEFAULT_OPTIONAL_CASE_IDS;
  const slackMs = deps.timingSlackMs ?? DEFAULT_TIMING_SLACK_MS;
  const problems: string[] = [];
  const attempts: AttemptRecord[] = [];
  const optionalSkips: Array<{ suite: ReleaseSuiteId; id: string; reason: string }> = [];
  const suiteSettingsById: Record<string, Record<string, string>> = {};
  let competitorMetadata: CompetitorMetadataRead = { known: false, skips: [], problem: null };
  const suites: Record<
    string,
    {
      cases: Array<{ id: string; status: string }>;
      attempts: Array<{ exitCode: number | null; startedAt: string; finishedAt: string }>;
    }
  > = {};
  // Suites the run never attempted because startup/collection failed, or that
  // fail-fast skipped after an earlier required suite failed. Marked explicitly
  // so a missing suite is never mistaken for a pass.
  const notRunSuites: ReleaseSuiteId[] = [];

  let candidateBefore: CandidateIdentity | null = null;
  try {
    candidateBefore = deps.fingerprint(deps.cwd);
  } catch (error) {
    problems.push(`candidate fingerprint before release failed: ${errorMessage(error)}`);
  }

  // Candidate-scoped, versioned namespace: v2/<full-commit>/<run-id>. The
  // commit segment makes other candidates' interrupted runs invisible to the
  // collector, while the full fingerprint pins the exact source revision.
  const candidateRoot = join(deps.runDirParent, "v2", candidateBefore?.commit ?? "unidentified");
  const runDir = deps.makeRunDir(candidateRoot, runId);
  const startupPath = join(runDir, RELEASE_EVAL_STARTUP_FILENAME);
  const attemptsPath = join(runDir, "attempts.jsonl");
  const evidencePath = join(runDir, "release-evidence.json");
  const incompletePath = join(runDir, "release-eval-incomplete.json");
  const summaryPath = join(runDir, "release-eval-summary.json");

  // Crash-safety anchor: persist the full candidate identity atomically before
  // the independent case collection or any child runs, so a SIGINT leaves a
  // scoped run whose identity the collector can require. This never depends on
  // JS signal handlers, which cannot interrupt a live spawnSync.
  let startupPersisted = false;
  if (candidateBefore !== null) {
    try {
      const startup = {
        format: RELEASE_EVAL_FORMAT_V2,
        schemaVersion: 2,
        runId,
        candidate: candidateBefore,
        startedAt,
      };
      deps.writeTextAtomic(startupPath, `${JSON.stringify(startup, null, 2)}\n`);
      startupPersisted = true;
    } catch (error) {
      problems.push(`release eval startup manifest could not be persisted: ${errorMessage(error)}`);
    }
  } else {
    problems.push("release eval startup manifest was not persisted: no candidate fingerprint");
  }

  const env = cleanReleaseEnv(deps.env, deps.now());
  let expected: ExpectedCaseIds | null = null;
  if (startupPersisted && candidateBefore !== null) {
    try {
      expected = normalizeExpectedCaseIds(
        deps.collectExpectedCaseIds({
          cwd: deps.cwd,
          env,
          runDir,
          timeoutMs: deps.listTimeoutMs ?? DEFAULT_LIST_TIMEOUT_MS,
        }),
        optionalCaseIds,
      );
    } catch (error) {
      problems.push(`independent expected-case collection failed: ${errorMessage(error)}`);
    }
  }

  if (expected !== null && startupPersisted) {
    for (let index = 0; index < RELEASE_SUITE_IDS.length; index += 1) {
      const suite = RELEASE_SUITE_IDS[index];
      const request = buildSuiteRequest(
        suite,
        env,
        deps.cwd,
        runDir,
        deps.suiteTimeoutMs ?? DEFAULT_SUITE_TIMEOUT_MS,
      );
      const attemptStartedAt = deps.now();
      let execution: ReleaseSuiteExecution;
      try {
        execution = deps.executeSuite(request);
      } catch (error) {
        // A throwing executor is a failed attempt, never an orchestrator crash:
        // the attempt is journaled and the run finalizes with a normal record.
        execution = { exitCode: null, signal: null, errorMessage: errorMessage(error) };
      }
      const attemptFinishedAt = deps.now();
      const window = {
        startedAtMs: attemptStartedAt.getTime(),
        finishedAtMs: attemptFinishedAt.getTime(),
      };
      const executionProblems: string[] = [];
      if (execution.errorMessage) {
        executionProblems.push(`${suite} child failed to run: ${execution.errorMessage}`);
      }
      if (execution.signal) {
        executionProblems.push(`${suite} child was terminated by signal ${execution.signal}`);
      }
      if (execution.exitCode !== 0) {
        executionProblems.push(`${suite} child exited with ${String(execution.exitCode)}`);
      }
      const read = readCompletion(
        request,
        execution,
        window,
        optionalCaseIds,
        slackMs,
        deps.readTextFile,
      );
      const suiteProblems = [...executionProblems, ...read.problems];
      const passed = suiteProblems.length === 0 && read.report !== undefined;
      const attempt: AttemptRecord = {
        format: RELEASE_EVAL_FORMAT_V2,
        runId,
        candidate: candidateBefore,
        suite,
        exitCode: execution.exitCode,
        signal: execution.signal ?? null,
        error: execution.errorMessage ?? null,
        verdict: passed ? "passed" : "failed",
        startedAt: attemptStartedAt.toISOString(),
        finishedAt: attemptFinishedAt.toISOString(),
        completionPath: request.completionPath,
        vitestJsonPath: request.vitestJsonPath,
      };
      attempts.push(attempt);
      deps.appendText(attemptsPath, `${JSON.stringify(attempt)}\n`);

      if (!passed || read.report === undefined) {
        problems.push(...suiteProblems);
        // Fail fast: later required suites are marked not run, never passed.
        notRunSuites.push(...RELEASE_SUITE_IDS.slice(index + 1));
        break;
      }
      const settings = suiteSettings(suite, read.report.settings, env);
      if (Object.keys(settings).length > 0) suiteSettingsById[suite] = settings;
      if (suite === "competitive:frozen") {
        competitorMetadata = readCompetitorMetadata(request.completionPath, deps.readTextFile);
        if (competitorMetadata.problem) problems.push(competitorMetadata.problem);
      }
      const optional = new Set(optionalCaseIds);
      suites[suite] = {
        cases: read.report.cases
          .filter((testCase) => !optional.has(testCase.id))
          .map((testCase) => ({ id: testCase.id, status: testCase.status })),
        attempts: [
          {
            exitCode: execution.exitCode,
            startedAt: attemptStartedAt.toISOString(),
            finishedAt: attemptFinishedAt.toISOString(),
          },
        ],
      };
      for (const testCase of read.report.cases) {
        if (optional.has(testCase.id) && testCase.status === "skipped") {
          optionalSkips.push({
            suite,
            id: testCase.id,
            reason: testCase.reason ?? "optional default-tier placeholder skipped",
          });
        }
      }
    }
  } else {
    notRunSuites.push(...RELEASE_SUITE_IDS);
  }

  let candidateAfter: CandidateIdentity | null = null;
  try {
    candidateAfter = deps.fingerprint(deps.cwd);
  } catch (error) {
    problems.push(`candidate fingerprint after release failed: ${errorMessage(error)}`);
  }
  if (
    candidateBefore !== null &&
    candidateAfter !== null &&
    !sameCandidate(candidateBefore, candidateAfter)
  ) {
    problems.push("candidate fingerprint changed during the release run");
  }

  const finishedAt = deps.now().toISOString();
  const evidence = {
    schemaVersion: 1,
    candidate: candidateBefore ?? undefined,
    startedAt,
    finishedAt,
    suites,
    // Absent metadata stays absent (unknown) rather than implying "none skipped".
    ...(competitorMetadata.known ? { competitors: competitorMetadata.skips } : {}),
  };

  if (expected !== null && candidateBefore !== null) {
    const validation = validateReleaseEvidence(evidence, {
      candidate: candidateBefore,
      expectedCaseIds: expected,
      now: deps.now().getTime(),
    }) as { valid: boolean; errors: string[] };
    if (!validation.valid) problems.push(...validation.errors);
  }

  const succeeded = problems.length === 0;
  let finalEvidencePath: string | null = null;
  let finalIncompletePath: string | null = null;
  const shared = {
    format: RELEASE_EVAL_FORMAT_V2,
    schemaVersion: 2,
    runId,
    runDir,
    candidate: candidateBefore ?? null,
    startedAt,
    finishedAt,
    notRunSuites,
    optionalSkips,
    suiteSettings: suiteSettingsById,
    // Release evidence must never rest on a cached competitor answer.
    competitiveCache: env.OPENCANDLE_COMPETITIVE_NO_CACHE === "1" ? "disabled" : "enabled",
    // `null` means the same-run metadata file was absent, so the skip set is
    // unknown; an array (possibly empty) means the runner reported it.
    competitors: competitorMetadata.known ? competitorMetadata.skips : null,
    competitorsKnown: competitorMetadata.known,
  };

  if (succeeded) {
    deps.writeTextAtomic(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    finalEvidencePath = evidencePath;
  } else {
    const incomplete = {
      ...shared,
      problems,
      attempts,
    };
    deps.writeTextAtomic(incompletePath, `${JSON.stringify(incomplete, null, 2)}\n`);
    finalIncompletePath = incompletePath;
  }

  const summary = {
    ...shared,
    exitCode: succeeded ? 0 : 1,
    evidencePath: finalEvidencePath,
    incompletePath: finalIncompletePath,
    attemptsPath,
    requiredSuites: [...RELEASE_SUITE_IDS],
  };
  deps.writeTextAtomic(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

  console.log("\n--- Release Eval Evidence ---");
  console.log(`Run directory: ${runDir}`);
  console.log(`Attempts log:  ${attemptsPath}`);
  if (finalEvidencePath) {
    console.log(`Evidence:      ${finalEvidencePath}`);
    console.log("Readiness:     complete candidate evidence written");
  } else {
    console.log(`Incomplete:    ${finalIncompletePath}`);
    console.log(`Readiness:     blocked by ${problems.length} problem(s)`);
    if (notRunSuites.length > 0) {
      console.log(`Not run:       ${notRunSuites.join(", ")}`);
    }
    for (const problem of problems) console.error(`release incomplete: ${problem}`);
  }

  return {
    exitCode: succeeded ? 0 : 1,
    runId,
    runDir,
    evidencePath: finalEvidencePath,
    attemptsPath,
    incompletePath: finalIncompletePath,
    summaryPath,
    problems,
    startedAt,
    finishedAt,
  };
}

/** Real filesystem/spawn dependencies used by the release front door. */
export function createRealReleaseDependencies(options: {
  cwd: string;
  env: NodeJS.ProcessEnv;
}): ReleaseEvidenceDeps {
  const cwd = options.cwd;
  return {
    cwd,
    env: options.env,
    runDirParent: join(cwd, "validation-output", "release-evals"),
    now: () => new Date(),
    fingerprint: (root) => fingerprintCandidate(root) as CandidateIdentity,
    collectExpectedCaseIds: (context) => collectRealExpectedCaseIds(context),
    executeSuite: (request) => {
      const result = spawnSync(request.command, request.args, {
        cwd,
        env: request.env,
        shell: false,
        stdio: "inherit",
        timeout: request.timeoutMs,
      });
      return {
        exitCode: result.status,
        signal: result.signal,
        errorMessage: result.error?.message,
      };
    },
    readTextFile: (path) => readFileSync(path, "utf-8"),
    writeTextAtomic: (path, content) => {
      mkdirSync(dirname(path), { recursive: true });
      const temporary = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
      try {
        writeFileSync(temporary, content, "utf-8");
        renameSync(temporary, path);
      } catch (error) {
        rmSync(temporary, { force: true });
        throw error;
      }
    },
    appendText: (path, content) => {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, content, "utf-8");
    },
    makeRunDir: (parent, runId) => {
      mkdirSync(parent, { recursive: true });
      const dir = join(parent, runId);
      mkdirSync(dir);
      return dir;
    },
  };
}

export function collectRealExpectedCaseIds(context: ExpectedCaseIdContext): ExpectedCaseIds {
  const routerDir = join(context.cwd, "tests", "fixtures", "router");
  const routerIds = readdirSync(routerDir)
    .filter((name) => name.endsWith(".json") && name !== "BASELINE.json")
    .sort();
  if (routerIds.length === 0) throw new Error("no router fixtures were found");
  const productIds = PRODUCT_EVAL_CASES.filter((evalCase) => evalCase.tier !== "opt-in").map(
    (evalCase) => evalCase.id,
  );
  if (productIds.length === 0) throw new Error("no default-tier product eval cases were found");
  const frozenIds = FROZEN_COMPETITIVE_PANEL.map((prompt) => prompt.id);
  if (frozenIds.length === 0) throw new Error("the frozen competitive panel is empty");
  return {
    "router-live": routerIds,
    cases: listVitestCaseIds(context, [
      "list",
      "--project",
      "evals",
      "--json",
      "--staticParse=false",
    ]),
    product: productIds,
    "competitive:frozen": frozenIds,
  };
}

/** Run a real `vitest list` and return canonical case ids (no test execution). */
export function listVitestCaseIds(
  context: Pick<ExpectedCaseIdContext, "cwd" | "env" | "timeoutMs">,
  args: string[],
): string[] {
  const result = spawnSync("vitest", args, {
    cwd: context.cwd,
    env: context.env,
    shell: false,
    encoding: "utf-8",
    timeout: context.timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw new Error(`vitest list failed to run: ${result.error.message}`);
  if (result.signal) throw new Error(`vitest list was terminated by signal ${result.signal}`);
  if (result.status !== 0) throw new Error(`vitest list exited with ${String(result.status)}`);
  const parsed = JSON.parse(result.stdout) as Array<{ name?: unknown }>;
  const ids = parsed
    .map((entry) => entry?.name)
    .filter((name): name is string => typeof name === "string" && name.trim() !== "")
    .map(canonicalizeVitestCaseId);
  if (ids.length === 0) throw new Error("vitest list returned no eval cases");
  return ids;
}
