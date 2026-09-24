#!/usr/bin/env node

// Compact, descriptive release summary.
//
// Joins the exact-candidate evidence that already exists in
// `validation-output/` (deterministic gate report, provider release smoke,
// release suite evidence, exact package proof) into ONE bounded JSON + Markdown
// artifact. It is deliberately narrow: it validates and aggregates, it does not
// run checks, does not accept arbitrary input paths, and is not release
// authorization. The trusted same-job executions remain the authority.
//
// Validation is strict and fail-closed:
// - only `release` gate reports count (later `core`/`full` diagnostics are not
//   authority), the checked-in policy digest and exact ordered release steps
//   are required, and any same-candidate failed attempt blocks the summary
//   even if a later retry passed (no retry-until-green, no waiver);
// - provider summaries must be the strict core shape actually produced by the
//   provider release smoke;
// - eval evidence must carry the full four-field candidate fingerprint, the
//   exact four required suites, non-empty all-passed unique case lists, and a
//   non-empty zero-exit attempt list;
// - settings and competitor metadata are whitelisted and bounded instead of
//   copied verbatim.

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fingerprintCandidate, REQUIRED_SUITE_IDS } from "./release-evidence.mjs";
import { runVerify } from "./release-package.mjs";
import { loadGatePolicy } from "./test-gate.mjs";

const VALIDATION_ROOT = "validation-output";
const DEFAULT_MAX_AGE_HOURS = 24;
const RELEASE_GATE = "release";
const POLICY_RELATIVE_PATH = join("scripts", "test-gate-policy.json");
const CANDIDATE_FIELDS = Object.freeze(["commit", "sourceDigest", "lockDigest", "policyDigest"]);

const PROVIDER_SCOPE = "core";
const PROVIDER_SYMBOL = "AAPL";
const PROVIDER_REQUIRED_CASES = Object.freeze(["get_stock_quote:AAPL", "get_stock_history:AAPL"]);
const PROVIDER_REQUIRED_TOTAL = PROVIDER_REQUIRED_CASES.length;

// Settings keys emitted by the validated completion report, never an open set.
const ALLOWED_SETTING_KEYS = Object.freeze(["provider", "model", "mode", "seed", "tier"]);
const MAX_SETTING_VALUE_LENGTH = 200;
const MAX_SKIP_REASON_LENGTH = 1000;
const MAX_COMPETITORS = 64;
const MAX_SUITE_ATTEMPTS = 64;
const MAX_OPTIONAL_SKIPS = 64;
const MAX_STRING_LENGTH = 500;

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function parseTimestamp(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Reject unparseable or future timestamps; return the parsed value when valid. */
function checkTimestamp(value, label, now, errors) {
  const parsed = parseTimestamp(value);
  if (parsed === null) {
    errors.push(`${label} must be a parseable timestamp`);
    return null;
  }
  if (parsed > now) {
    errors.push(`${label} must not be in the future`);
    return null;
  }
  return parsed;
}

function checkFreshness(parsed, label, now, windowMs, errors) {
  if (parsed !== null && now - parsed > windowMs) errors.push(`${label} is stale`);
}

export function parseSummaryArgs(argv, { cwd = process.cwd() } = {}) {
  let packageDir = join(cwd, VALIDATION_ROOT, "release");
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg !== "--package-dir") return { ok: false, error: `unknown argument "${arg}"` };
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      return { ok: false, error: "--package-dir requires a path" };
    }
    packageDir = resolve(cwd, value);
    index += 1;
  }
  const validationRoot = resolve(cwd, VALIDATION_ROOT);
  const rel = relative(validationRoot, packageDir);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return { ok: false, error: `--package-dir must be inside ${VALIDATION_ROOT}` };
  }
  return { ok: true, packageDir, relativePackageDir: relative(cwd, packageDir) };
}

// Any unreadable JSON under a required evidence directory is a conservative
// reject: it could have been a matching required report whose failure or
// success would change the verdict, so it must never be silently skipped.
function readJson(path, label, errors) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    errors.push(`${label} is missing or unreadable`);
    return null;
  }
}

function listJsonFiles(dir) {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => join(dir, name));
  } catch {
    return [];
  }
}

function listRunSummaries(dir, filename) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(dir, entry.name, filename));
  } catch {
    return [];
  }
}

function byTime(getTime) {
  return (left, right) => {
    const a = Date.parse(getTime(left));
    const b = Date.parse(getTime(right));
    if (!Number.isFinite(a)) return -1;
    if (!Number.isFinite(b)) return 1;
    return a - b;
  };
}

// ---------------------------------------------------------------------------
// Deterministic release gate
// ---------------------------------------------------------------------------

function readCheckedInPolicy(root, errors) {
  const policyPath = join(root, POLICY_RELATIVE_PATH);
  try {
    const bytes = readFileSync(policyPath);
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    return { policy: loadGatePolicy(policyPath), policyDigest: digest };
  } catch {
    errors.push("checked-in gate policy (scripts/test-gate-policy.json) is missing or invalid");
    return { policy: null, policyDigest: null };
  }
}

function gateAttemptProblems(report, { expectedSteps, candidate, policyDigest, now }) {
  const problems = [];
  if (report.overall !== "passed") problems.push("release gate attempt failed");
  if (report.insideWorkTree !== true) {
    problems.push("release gate attempt was not produced inside a git work tree");
  }
  if (report.headChanged !== false) {
    problems.push("release gate attempt recorded HEAD changing during the run");
  }
  if (report.headBefore !== candidate.commit || report.headAfter !== candidate.commit) {
    problems.push("release gate attempt HEAD does not match the current candidate");
  }
  if (report.failedStep !== null && report.failedStep !== undefined) {
    problems.push("release gate attempt recorded a failed step");
  }
  if (report.policyDigest !== policyDigest) {
    problems.push("release gate attempt policy digest does not match the checked-in gate policy");
  }
  const started = checkTimestamp(report.startedAt, "release gate startedAt", now, problems);
  const finished = checkTimestamp(report.finishedAt, "release gate finishedAt", now, problems);
  if (started !== null && finished !== null && finished < started) {
    problems.push("release gate finishedAt is before startedAt");
  }
  if (!Array.isArray(report.steps)) {
    problems.push("release gate attempt has no step list");
    return problems;
  }
  if (expectedSteps !== null) {
    const names = report.steps.map((step) => (isPlainObject(step) ? step.step : null));
    const matches =
      names.length === expectedSteps.length &&
      names.every((name, index) => name === expectedSteps[index]);
    if (!matches) {
      problems.push("release gate attempt steps do not match the checked-in release policy");
    }
  }
  for (const step of report.steps) {
    if (!isPlainObject(step) || step.status !== 0) {
      problems.push("release gate attempt has a failed step that did not exit zero");
      break;
    }
  }
  for (const step of report.steps) {
    if (isPlainObject(step) && step.signal !== null && step.signal !== undefined) {
      problems.push("release gate attempt has a step terminated by a signal");
      break;
    }
  }
  return problems;
}

function collectGate(root, candidate, now, windowMs, errors) {
  const { policy, policyDigest } = readCheckedInPolicy(root, errors);
  const expectedSteps = policy ? [...policy[RELEASE_GATE]] : null;

  const reports = listJsonFiles(join(root, VALIDATION_ROOT, "gates"))
    .map((path) => readJson(path, `gate report ${path}`, errors))
    .filter(
      (report) =>
        isPlainObject(report) &&
        report.candidateCommit === candidate.commit &&
        report.gate === RELEASE_GATE,
    );
  if (reports.length === 0) {
    errors.push("required release gate report for the current candidate is missing");
    return null;
  }
  reports.sort(byTime((report) => report.startedAt));
  const attempts = reports.map((report) => ({
    startedAt: report.startedAt ?? null,
    finishedAt: report.finishedAt ?? null,
    overall: report.overall ?? null,
    failedStep: report.failedStep ?? null,
  }));

  let latest = null;
  for (const report of reports) {
    const problems = gateAttemptProblems(report, {
      expectedSteps,
      candidate,
      policyDigest,
      now,
    });
    if (problems.length > 0) {
      errors.push(...problems);
    } else {
      latest = report;
    }
  }
  if (latest === null) {
    if (!errors.some((error) => /release gate/i.test(error))) {
      errors.push("no clean release gate attempt exists for the current candidate");
    }
    return null;
  }
  // Only the latest selected successful attempt must be fresh; an expired
  // success may be refreshed by a newer successful attempt.
  checkFreshness(parseTimestamp(latest.finishedAt), "release gate report", now, windowMs, errors);
  return {
    gate: latest.gate,
    startedAt: latest.startedAt,
    finishedAt: latest.finishedAt,
    overall: latest.overall,
    failedStep: latest.failedStep ?? null,
    node: latest.node ?? null,
    platform: latest.platform ?? null,
    headBefore: latest.headBefore ?? null,
    headAfter: latest.headAfter ?? null,
    headChanged: latest.headChanged === true,
    policyDigest: latest.policyDigest ?? null,
    steps: latest.steps.map((step) => ({
      name: step.step,
      status: step.status,
      signal: step.signal ?? null,
      durationMs: step.durationMs,
    })),
    attempts,
  };
}

// ---------------------------------------------------------------------------
// Provider release smoke
// ---------------------------------------------------------------------------

export function providerSummaryProblems(summary, now, windowMs, enforceFreshness = true) {
  const problems = [];
  const started = checkTimestamp(summary.startedAt, "provider startedAt", now, problems);
  const finished = checkTimestamp(summary.finishedAt, "provider finishedAt", now, problems);
  if (started !== null && finished !== null && finished < started) {
    problems.push("provider finishedAt is before startedAt");
  }
  if (enforceFreshness) {
    checkFreshness(finished, "provider release summary", now, windowMs, problems);
  }

  if (summary.scope !== PROVIDER_SCOPE || summary.symbol !== PROVIDER_SYMBOL) {
    problems.push("provider release summary is not the strict core AAPL run");
  }
  if (summary.strict !== true) problems.push("provider release summary strict must be true");
  if (summary.timedOut !== false) problems.push("provider release summary timedOut must be false");
  if (summary.fatal !== false) problems.push("provider release summary fatal must be false");

  const totals = summary.totals;
  if (!isPlainObject(totals)) {
    problems.push("provider release summary totals are missing");
  } else {
    const { passed, failed, skipped } = totals;
    if (
      totals.total !== PROVIDER_REQUIRED_TOTAL ||
      passed !== PROVIDER_REQUIRED_TOTAL ||
      failed !== 0 ||
      skipped !== 0
    ) {
      problems.push("provider release summary totals are not 2 passed / 0 failed / 0 skipped");
    } else if (passed + failed + skipped !== totals.total) {
      problems.push("provider release summary totals are inconsistent");
    }
  }

  const cases = Array.isArray(summary.cases) ? summary.cases : null;
  if (cases === null) {
    problems.push("provider release summary cases are missing");
  } else {
    const names = cases.map((entry) => (isPlainObject(entry) ? entry.name : null));
    const required = new Set(PROVIDER_REQUIRED_CASES);
    const unique = new Set(names);
    const matches =
      cases.length === PROVIDER_REQUIRED_TOTAL &&
      unique.size === PROVIDER_REQUIRED_TOTAL &&
      names.every((name) => required.has(name));
    if (!matches) {
      problems.push("provider release summary does not contain the two required core cases");
    }
    if (cases.some((entry) => !isPlainObject(entry) || entry.status !== "passed")) {
      problems.push("provider release summary has a required case that did not pass");
    }
  }
  return problems;
}

function collectProvider(root, candidate, now, windowMs, errors) {
  const summaries = listRunSummaries(
    join(root, VALIDATION_ROOT, "provider-release"),
    "summary.json",
  )
    .map((path) => readJson(path, `provider summary ${path}`, errors))
    .filter((summary) => isPlainObject(summary) && summary.candidateCommit === candidate.commit);
  if (summaries.length === 0) {
    errors.push("required provider release summary for the current candidate is missing");
    return null;
  }
  summaries.sort(byTime((summary) => summary.finishedAt ?? summary.startedAt));
  const attempts = summaries.map((summary) => ({
    runId: summary.runId ?? null,
    startedAt: summary.startedAt ?? null,
    finishedAt: summary.finishedAt ?? null,
    passed: summary.totals?.passed ?? null,
    failed: summary.totals?.failed ?? null,
    skipped: summary.totals?.skipped ?? null,
  }));

  let latest = null;
  for (const summary of summaries) {
    const problems = providerSummaryProblems(summary, now, windowMs, false);
    if (problems.length > 0) {
      errors.push(...problems.map((problem) => `provider release summary: ${problem}`));
    } else {
      latest = summary;
    }
  }
  if (latest === null) {
    if (!errors.some((error) => /provider/i.test(error))) {
      errors.push("no clean provider release summary exists for the current candidate");
    }
    return null;
  }
  // Only the latest selected successful attempt must be fresh; an expired
  // success may be refreshed by a newer successful attempt.
  checkFreshness(
    parseTimestamp(latest.finishedAt),
    "provider release summary",
    now,
    windowMs,
    errors,
  );
  const cases = latest.cases;
  return {
    runId: latest.runId ?? null,
    startedAt: latest.startedAt ?? null,
    finishedAt: latest.finishedAt ?? null,
    provider: latest.provider ?? null,
    scope: latest.scope ?? null,
    symbol: latest.symbol ?? null,
    totals: {
      passed: latest.totals.passed,
      failed: latest.totals.failed,
      skipped: latest.totals.skipped,
      total: latest.totals.total,
    },
    skips: cases.filter((entry) => entry.status === "skipped").map((entry) => entry.name),
    attempts,
  };
}

// ---------------------------------------------------------------------------
// Release eval evidence
// ---------------------------------------------------------------------------

function candidateProblems(identity, candidate) {
  const problems = [];
  if (!isPlainObject(identity)) {
    problems.push("release eval evidence candidate is missing");
    return problems;
  }
  for (const field of CANDIDATE_FIELDS) {
    const expected = candidate[field];
    const actual = identity[field];
    if (!isNonEmptyString(actual)) {
      problems.push(`release eval evidence candidate.${field} must be a non-empty string`);
    } else if (actual !== expected) {
      problems.push("release eval evidence candidate does not match the current candidate");
    }
  }
  return problems;
}

function suiteProblems(suiteId, suite, now) {
  const label = `release eval suite "${suiteId}"`;
  const problems = [];
  if (!isPlainObject(suite)) {
    problems.push(`${label} must be an object`);
    return problems;
  }
  const cases = Array.isArray(suite.cases) ? suite.cases : null;
  if (cases === null || cases.length === 0) {
    problems.push(`${label} must list at least one case outcome`);
  } else {
    const seen = new Set();
    for (const entry of cases) {
      if (!isPlainObject(entry) || !isNonEmptyString(entry.id)) {
        problems.push(`${label} has a case without a non-empty id`);
        continue;
      }
      if (seen.has(entry.id)) {
        problems.push(`${label} lists a duplicate case id`);
        continue;
      }
      seen.add(entry.id);
      if (entry.status !== "passed") {
        problems.push(`${label} has a required case that did not pass`);
      }
    }
  }
  const attempts = Array.isArray(suite.attempts) ? suite.attempts : null;
  if (attempts === null || attempts.length === 0) {
    problems.push(`${label} must record at least one completed attempt`);
  } else if (attempts.length > MAX_SUITE_ATTEMPTS) {
    problems.push(`${label} records too many attempts`);
  } else {
    for (const attempt of attempts) {
      if (!isPlainObject(attempt) || attempt.exitCode !== 0) {
        problems.push(`${label} has an attempt that did not exit zero`);
        continue;
      }
      const started = checkTimestamp(
        attempt.startedAt,
        `${label} attempt startedAt`,
        now,
        problems,
      );
      const finished = checkTimestamp(
        attempt.finishedAt,
        `${label} attempt finishedAt`,
        now,
        problems,
      );
      if (started !== null && finished !== null && finished < started) {
        problems.push(`${label} attempt finishedAt is before startedAt`);
      }
    }
  }
  return problems;
}

/**
 * Age-window freshness for the latest selected successful eval run only; it
 * includes every attempt recorded in that run's evidence. Older successful runs
 * stay in the preserved history instead of blocking a refreshed summary.
 */
function evalFreshnessProblems(summary, evidence, now, windowMs) {
  const problems = [];
  checkFreshness(
    parseTimestamp(summary.finishedAt),
    "release eval summary",
    now,
    windowMs,
    problems,
  );
  checkFreshness(
    parseTimestamp(evidence.finishedAt),
    "release eval evidence",
    now,
    windowMs,
    problems,
  );
  const suites = isPlainObject(evidence.suites) ? evidence.suites : {};
  for (const suiteId of REQUIRED_SUITE_IDS) {
    const suite = suites[suiteId];
    const attempts = isPlainObject(suite) && Array.isArray(suite.attempts) ? suite.attempts : [];
    for (const attempt of attempts) {
      if (isPlainObject(attempt)) {
        checkFreshness(
          parseTimestamp(attempt.finishedAt),
          `release eval suite "${suiteId}" attempt`,
          now,
          windowMs,
          problems,
        );
      }
    }
  }
  return problems;
}

function evalProblems(summary, evidence, candidate, now) {
  const problems = [];
  const started = checkTimestamp(summary.startedAt, "release eval startedAt", now, problems);
  const finished = checkTimestamp(summary.finishedAt, "release eval finishedAt", now, problems);
  if (started !== null && finished !== null && finished < started) {
    problems.push("release eval finishedAt is before startedAt");
  }

  if (summary.exitCode !== 0) {
    problems.push("release eval run did not exit zero");
  }
  const required = summary.requiredSuites;
  if (
    !Array.isArray(required) ||
    required.length !== REQUIRED_SUITE_IDS.length ||
    !required.every((suite, index) => suite === REQUIRED_SUITE_IDS[index])
  ) {
    problems.push("release eval summary requiredSuites does not match the required suite list");
  }
  if (!isPlainObject(evidence)) {
    problems.push("release eval evidence is missing");
    return problems;
  }
  problems.push(...candidateProblems(evidence.candidate, candidate));

  const evidenceStarted = checkTimestamp(
    evidence.startedAt,
    "release eval evidence startedAt",
    now,
    problems,
  );
  const evidenceFinished = checkTimestamp(
    evidence.finishedAt,
    "release eval evidence finishedAt",
    now,
    problems,
  );
  if (evidenceStarted !== null && evidenceFinished !== null && evidenceFinished < evidenceStarted) {
    problems.push("release eval evidence finishedAt is before startedAt");
  }

  const suites = evidence.suites;
  if (!isPlainObject(suites)) {
    problems.push("release eval evidence suites are missing");
    return problems;
  }
  for (const suiteId of Object.keys(suites)) {
    if (!REQUIRED_SUITE_IDS.includes(suiteId)) {
      problems.push("release eval evidence contains an unexpected suite");
    }
  }
  for (const suiteId of REQUIRED_SUITE_IDS) {
    if (!Object.hasOwn(suites, suiteId)) {
      problems.push(`release eval evidence is missing required suite "${suiteId}"`);
      continue;
    }
    problems.push(...suiteProblems(suiteId, suites[suiteId], now));
  }
  return problems;
}

function collectSettings(suiteSettings, errors) {
  if (suiteSettings === undefined || suiteSettings === null) return {};
  if (!isPlainObject(suiteSettings)) {
    errors.push("release eval suite settings must be an object");
    return {};
  }
  const out = {};
  for (const [suite, settings] of Object.entries(suiteSettings)) {
    if (!REQUIRED_SUITE_IDS.includes(suite)) {
      errors.push("release eval suite settings include an unknown suite");
      continue;
    }
    if (!isPlainObject(settings)) {
      errors.push("release eval suite settings for a required suite must be an object");
      continue;
    }
    const clean = {};
    for (const [key, value] of Object.entries(settings)) {
      if (!ALLOWED_SETTING_KEYS.includes(key)) {
        errors.push("release eval suite settings include an unsupported field");
        continue;
      }
      if (
        typeof value !== "string" ||
        value.length === 0 ||
        value.length > MAX_SETTING_VALUE_LENGTH ||
        /[\r\n]/.test(value)
      ) {
        errors.push(`release eval suite setting "${key}" must be a short single-line string`);
        continue;
      }
      clean[key] = value;
    }
    out[suite] = clean;
  }
  return out;
}

function collectOptionalSkips(optionalSkips, errors) {
  if (optionalSkips === undefined || optionalSkips === null) return [];
  if (!Array.isArray(optionalSkips)) {
    errors.push("release eval optional skips must be an array");
    return [];
  }
  if (optionalSkips.length > MAX_OPTIONAL_SKIPS) {
    errors.push("release eval optional skip list is too long");
    return [];
  }
  const out = [];
  for (const skip of optionalSkips) {
    if (!isPlainObject(skip)) {
      errors.push("release eval optional skip entry must be an object");
      continue;
    }
    const keys = Object.keys(skip);
    if (keys.some((key) => key !== "suite" && key !== "id" && key !== "reason")) {
      errors.push("release eval optional skip entry has unsupported fields");
      continue;
    }
    if (!REQUIRED_SUITE_IDS.includes(skip.suite)) {
      errors.push("release eval optional skip entry names an unknown suite");
      continue;
    }
    if (
      !isNonEmptyString(skip.id) ||
      skip.id.length > MAX_STRING_LENGTH ||
      !isNonEmptyString(skip.reason) ||
      skip.reason.length > MAX_SKIP_REASON_LENGTH
    ) {
      errors.push("release eval optional skip entry must have a bounded id and reason");
      continue;
    }
    out.push({ suite: skip.suite, id: skip.id, reason: skip.reason });
  }
  return out;
}

function collectCompetitors(summary, errors) {
  const known = summary.competitorsKnown === true;
  const competitors = summary.competitors;
  if (competitors === undefined || competitors === null) {
    return { competitors: null, competitorsKnown: known && competitors !== undefined };
  }
  if (!Array.isArray(competitors)) {
    errors.push("release eval competitors must be an array or null");
    return { competitors: null, competitorsKnown: known };
  }
  if (competitors.length > MAX_COMPETITORS) {
    errors.push("release eval competitor list is too long");
    return { competitors: null, competitorsKnown: known };
  }
  const clean = [];
  for (const entry of competitors) {
    if (!isPlainObject(entry)) {
      errors.push("release eval competitor entry must be an object");
      continue;
    }
    const keys = Object.keys(entry);
    if (keys.some((key) => key !== "id" && key !== "reason")) {
      errors.push("release eval competitor entry has unsupported fields");
      continue;
    }
    if (
      !isNonEmptyString(entry.id) ||
      entry.id.length > MAX_STRING_LENGTH ||
      !isNonEmptyString(entry.reason) ||
      entry.reason.length > MAX_SKIP_REASON_LENGTH
    ) {
      errors.push("release eval competitor entry must have a bounded id and reason");
      continue;
    }
    clean.push({ id: entry.id, reason: entry.reason });
  }
  return { competitors: clean, competitorsKnown: known };
}

function collectEvals(root, candidate, now, windowMs, errors) {
  const runDirs = listRunSummaries(
    join(root, VALIDATION_ROOT, "release-evals"),
    "release-eval-summary.json",
  );
  const entries = [];
  for (const summaryPath of runDirs) {
    const summary = readJson(summaryPath, `eval summary ${summaryPath}`, errors);
    if (!isPlainObject(summary)) continue;
    const runDir = dirname(summaryPath);
    const evidenceName =
      summary.exitCode === 0 ? "release-evidence.json" : "release-eval-incomplete.json";
    const evidence = readJson(join(runDir, evidenceName), `eval evidence ${runDir}`, errors);
    if (!isPlainObject(evidence)) continue;
    const identity = evidence.candidate;
    // A run whose recorded commit differs is unrelated historical evidence;
    // only same-commit runs can attest the current candidate.
    if (!isPlainObject(identity) || identity.commit !== candidate.commit) continue;
    const problems = evalProblems(summary, evidence, candidate, now);
    if (problems.length > 0) {
      errors.push(...problems.map((problem) => `release eval: ${problem}`));
    } else {
      entries.push({ summary, evidence });
    }
  }
  if (entries.length === 0) {
    if (!errors.some((error) => /release eval/i.test(error))) {
      errors.push("required release eval summary for the current candidate is missing");
    }
    return null;
  }
  entries.sort(byTime((entry) => entry.summary.finishedAt ?? entry.summary.startedAt));
  const attempts = entries.map(({ summary }) => ({
    runId: summary.runId ?? null,
    startedAt: summary.startedAt ?? null,
    finishedAt: summary.finishedAt ?? null,
    exitCode: summary.exitCode ?? null,
  }));
  const latest = entries[entries.length - 1];
  // Only the latest selected successful run must be fresh, including every
  // attempt within its evidence; older successes stay as preserved history.
  errors.push(
    ...evalFreshnessProblems(latest.summary, latest.evidence, now, windowMs).map(
      (problem) => `release eval: ${problem}`,
    ),
  );
  const suites = isPlainObject(latest.evidence.suites) ? latest.evidence.suites : {};
  const suiteCounts = {};
  for (const [suiteId, suite] of Object.entries(suites)) {
    const cases = Array.isArray(suite?.cases) ? suite.cases : [];
    suiteCounts[suiteId] = {
      passed: cases.filter((entry) => entry.status === "passed").length,
      failed: cases.filter((entry) => entry.status === "failed").length,
      skipped: cases.filter((entry) => entry.status === "skipped").length,
      total: cases.length,
    };
  }
  const { competitors, competitorsKnown } = collectCompetitors(latest.summary, errors);
  return {
    runId: latest.summary.runId ?? null,
    startedAt: latest.summary.startedAt ?? null,
    finishedAt: latest.summary.finishedAt ?? null,
    completedSuites: Object.keys(suites).length,
    requiredSuites: REQUIRED_SUITE_IDS.length,
    suiteCounts,
    models: collectSettings(latest.summary.suiteSettings, errors),
    optionalSkips: collectOptionalSkips(latest.summary.optionalSkips, errors),
    competitors,
    competitorsKnown,
    attempts,
  };
}

// ---------------------------------------------------------------------------
// Package proof and coverage
// ---------------------------------------------------------------------------

function collectPackage(root, packageDir, candidate, now, windowMs, errors) {
  try {
    runVerify({ root, dir: packageDir });
  } catch (error) {
    errors.push(
      `package proof verification failed: ${error instanceof Error ? error.message : "unknown"}`,
    );
    return null;
  }
  const proof = readJson(join(packageDir, "package-proof.json"), "package-proof.json", errors);
  if (!proof) return null;
  if (proof.candidateCommit !== candidate.commit) {
    errors.push("package proof candidate does not match the current candidate");
  }
  const testedAt = checkTimestamp(proof.testedAt, "package proof testedAt", now, errors);
  checkFreshness(testedAt, "package proof", now, windowMs, errors);
  return {
    name: proof.packageName ?? null,
    version: proof.packageVersion ?? null,
    sha256: proof.sha256 ?? null,
    tarball: proof.tarball ?? null,
    path: relative(root, join(packageDir, proof.tarball ?? "")),
    testedAt: proof.testedAt ?? null,
    smokePassed: proof.smokePassed === true,
  };
}

function collectCoverage(root) {
  const path = join(root, "coverage", "coverage-summary.json");
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { available: false, label: "gate-derived", note: "coverage summary not present" };
  }
  const total = isPlainObject(raw.total) ? raw.total : {};
  const pick = (metric) =>
    isPlainObject(metric)
      ? { total: metric.total ?? null, covered: metric.covered ?? null, pct: metric.pct ?? null }
      : null;
  return {
    available: true,
    label: "gate-derived",
    source: "coverage/coverage-summary.json",
    totals: {
      lines: pick(total.lines),
      functions: pick(total.functions),
      branches: pick(total.branches),
      statements: pick(total.statements),
    },
  };
}

function attemptSummary(attempts, isFailed) {
  const failed = attempts.filter(isFailed).length;
  return `${attempts.length} attempt(s), ${failed} failed`;
}

export function buildReleaseSummary({
  root = process.cwd(),
  packageDir,
  now = Date.now(),
  maxAgeHours = DEFAULT_MAX_AGE_HOURS,
} = {}) {
  const errors = [];
  const validationRoot = join(root, VALIDATION_ROOT);
  const resolvedPackageDir = packageDir
    ? isAbsolute(packageDir)
      ? packageDir
      : resolve(root, packageDir)
    : join(validationRoot, "release");
  const relPackage = relative(validationRoot, resolvedPackageDir);
  if (relPackage.startsWith("..") || isAbsolute(relPackage)) {
    errors.push(`package directory must be inside ${VALIDATION_ROOT}`);
  }
  if (typeof maxAgeHours !== "number" || !Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
    errors.push("maxAgeHours must be a positive finite number");
    return { ok: false, errors, summary: null, markdown: null };
  }
  const windowMs = maxAgeHours * 60 * 60 * 1000;

  let candidate;
  try {
    candidate = fingerprintCandidate(root);
  } catch (error) {
    errors.push(
      `candidate fingerprint failed: ${error instanceof Error ? error.message : "unknown"}`,
    );
    return { ok: false, errors, summary: null, markdown: null };
  }

  const gate = collectGate(root, candidate, now, windowMs, errors);
  const provider = collectProvider(root, candidate, now, windowMs, errors);
  const evals = collectEvals(root, candidate, now, windowMs, errors);
  const pkg = collectPackage(root, resolvedPackageDir, candidate, now, windowMs, errors);
  const coverage = collectCoverage(root);

  if (errors.length > 0) {
    return { ok: false, errors, summary: null, markdown: null };
  }

  const summary = {
    schemaVersion: 1,
    kind: "release-summary",
    descriptiveOnly: true,
    releaseAuthorization: false,
    generatedAt: new Date(now).toISOString(),
    candidate,
    package: pkg,
    deterministicGate: gate,
    coverage,
    releaseEvals: evals,
    providerRelease: provider,
    unmeasured: {
      childProcess: true,
      webContainer: true,
      releaseEnvironmentProtection: "externally-unverified",
    },
    waiver: null,
    notes: [
      "Descriptive evidence only; trusted same-job executions remain the authority.",
      "No waiver mechanism is implemented.",
      "Every locally available same-candidate attempt is preserved; any failed attempt blocks a complete summary even if a later retry passed.",
    ],
  };

  const stepLine = gate.steps
    .map((step) => `\`${step.name}\` ${step.status === 0 ? "passed" : "failed"}`)
    .join(", ");
  const markdown = [
    `# Release summary (${candidate.commit.slice(0, 12)})`,
    "",
    "Descriptive evidence only — not release authorization.",
    "",
    `- Candidate: \`${candidate.commit}\``,
    `- Package: ${pkg.name}@${pkg.version} (\`${pkg.tarball}\`, sha256 \`${String(pkg.sha256).slice(0, 12)}…\`)`,
    `- Deterministic gate: ${gate.overall} (${attemptSummary(gate.attempts, (attempt) => attempt.overall !== "passed")}) — ${stepLine}`,
    `- Release evals: ${evals.completedSuites}/${evals.requiredSuites} suites, optional skips ${evals.optionalSkips.length}, competitors ${evals.competitorsKnown ? "recorded" : "unknown"} (${attemptSummary(evals.attempts, (attempt) => attempt.exitCode !== 0)})`,
    `- Provider smoke: ${provider.totals.passed} passed / ${provider.totals.failed} failed / ${provider.totals.skipped} skipped (${attemptSummary(provider.attempts, (attempt) => attempt.failed !== 0)})`,
    `- Coverage (gate-derived): ${coverage.available ? "recorded" : "unavailable"}`,
    "- Unmeasured: Node child-process and WebContainer coverage; release environment protection externally unverified.",
    "- Waiver: none implemented.",
    "",
  ].join("\n");

  return { ok: true, errors, summary, markdown };
}

export function writeReleaseSummary({
  root = process.cwd(),
  packageDir,
  now = Date.now(),
  maxAgeHours,
} = {}) {
  const built = buildReleaseSummary({ root, packageDir, now, maxAgeHours });
  if (!built.ok) return { ok: false, errors: built.errors, dir: null };
  const base = join(root, VALIDATION_ROOT, "release-summary");
  mkdirSync(base, { recursive: true });
  const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
  let dir = join(base, `${stamp}-${process.pid}`);
  for (let suffix = 1; ; suffix += 1) {
    try {
      mkdirSync(dir);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      dir = join(base, `${stamp}-${process.pid}-${suffix}`);
    }
  }
  writeFileSync(join(dir, "summary.json"), `${JSON.stringify(built.summary, null, 2)}\n`);
  writeFileSync(join(dir, "summary.md"), built.markdown);
  return { ok: true, errors: [], dir, summary: built.summary, markdown: built.markdown };
}

function main(argv) {
  const parsed = parseSummaryArgs(argv);
  if (!parsed.ok) {
    process.stderr.write(`Error: ${parsed.error}\n`);
    process.stderr.write(
      "Usage: node scripts/release-summary.mjs [--package-dir validation-output/release]\n",
    );
    process.exit(1);
  }
  const result = writeReleaseSummary({ packageDir: parsed.packageDir });
  if (!result.ok) {
    for (const error of result.errors) process.stderr.write(`release summary: ${error}\n`);
    process.exit(1);
  }
  console.log(`release summary: ${join(result.dir, "summary.json")}`);
  console.log(`release summary: ${join(result.dir, "summary.md")}`);
}

const isDirectRun =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  main(process.argv.slice(2));
}
