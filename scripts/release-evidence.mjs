/**
 * Pure release evidence validation and candidate fingerprinting helpers.
 *
 * Verifies content only: no authenticity, approval, publication, CI, or
 * credential decision. Never executes untrusted values, never reads credential
 * files, and returns only SHA-256 digests (never source content). Candidate
 * identity is `{ commit, sourceDigest, lockDigest, policyDigest }`; `commit` is
 * the exact `git rev-parse HEAD` and the digests are exact content digests over
 * tracked working-tree files. Version metadata is intentionally not normalized
 * yet, so any content change changes the digest.
 * @see validateReleaseEvidence for the evidence schema and its rules.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export const EVIDENCE_SCHEMA_VERSION = 1;

export const REQUIRED_SUITE_IDS = Object.freeze([
  "router-live",
  "cases",
  "product",
  "competitive:frozen",
]);

const CANDIDATE_FIELDS = Object.freeze(["commit", "sourceDigest", "lockDigest", "policyDigest"]);
const ALLOWED_MODEL_FIELDS = Object.freeze(["provider", "model", "seed"]);
const SAFE_ENV_TEMPLATES = Object.freeze(["example", "sample", "template", "defaults", "dist"]);
const DEFAULT_MAX_AGE_HOURS = 24;
const POLICY_VITEST_FILES = new Set(["vitest.config.ts", "vitest.projects.ts"]);

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function parseTimestamp(value) {
  if (value instanceof Date) value = value.getTime();
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validateCandidate(evidenceCandidate, expectedCandidate, errors) {
  if (!isPlainObject(expectedCandidate)) {
    errors.push(
      "a candidate identity (commit, sourceDigest, lockDigest, policyDigest) is required",
    );
    return;
  }
  if (!isPlainObject(evidenceCandidate)) {
    errors.push("evidence.candidate must be an object with the four candidate identity fields");
    return;
  }
  for (const field of CANDIDATE_FIELDS) {
    const expected = expectedCandidate[field];
    const actual = evidenceCandidate[field];
    if (!isNonEmptyString(expected)) {
      errors.push(`candidate.${field} must be a non-empty string`);
    } else if (!isNonEmptyString(actual)) {
      errors.push(`evidence.candidate.${field} must be a non-empty string`);
    } else if (actual !== expected) {
      errors.push(`evidence.candidate.${field} does not match the supplied candidate identity`);
    }
  }
}

function expectedCaseSets(expectedCaseIds, errors) {
  if (!isPlainObject(expectedCaseIds)) {
    errors.push(
      "options.expectedCaseIds must supply the expected case ids for every required suite",
    );
    return null;
  }
  const sets = new Map();
  for (const suiteId of REQUIRED_SUITE_IDS) {
    if (!Object.hasOwn(expectedCaseIds, suiteId)) {
      errors.push(
        `options.expectedCaseIds is missing the expected case ids for suite "${suiteId}"`,
      );
      continue;
    }
    const ids = expectedCaseIds[suiteId];
    if (!Array.isArray(ids) || ids.length === 0) {
      errors.push(`options.expectedCaseIds["${suiteId}"] must be a non-empty array of case ids`);
      continue;
    }
    const set = new Set();
    let valid = true;
    for (const id of ids) {
      if (!isNonEmptyString(id) || set.has(id)) {
        errors.push(`options.expectedCaseIds["${suiteId}"] must be unique non-empty case ids`);
        valid = false;
        break;
      }
      set.add(id);
    }
    if (valid) sets.set(suiteId, set);
  }
  return sets;
}

function validateCases(suiteId, cases, expected, errors) {
  const label = `suite "${suiteId}"`;
  if (!Array.isArray(cases) || cases.length === 0) {
    errors.push(`${label} must list at least one case outcome`);
    return;
  }
  const seen = new Set();
  for (let index = 0; index < cases.length; index += 1) {
    const caseOutcome = cases[index];
    const where = `${label} case at index ${index}`;
    if (!isPlainObject(caseOutcome)) {
      errors.push(`${where} must be an object`);
      continue;
    }
    const id = caseOutcome.id;
    if (!isNonEmptyString(id)) {
      errors.push(`${where} must have a non-empty string id`);
      continue;
    }
    if (seen.has(id)) {
      errors.push(`${label} lists duplicate case id "${id}"`);
      continue;
    }
    seen.add(id);
    const status = caseOutcome.status;
    if (status !== "passed" && status !== "failed" && status !== "skipped") {
      errors.push(`${label} case "${id}" has unsupported status`);
      continue;
    }
    if (status === "passed") continue;
    if (status === "skipped" && !isNonEmptyString(caseOutcome.reason)) {
      errors.push(`${label} case "${id}" was skipped without a reason`);
    }
    errors.push(`${label} required case "${id}" did not pass (status "${status}")`);
  }
  if (expected === null) return;
  for (const id of expected) {
    if (!seen.has(id)) errors.push(`${label} is missing expected case id "${id}"`);
  }
  for (const id of seen) {
    if (!expected.has(id)) errors.push(`${label} reports unexpected case id "${id}"`);
  }
}

function validateAttempts(suiteId, attempts, window, now, errors) {
  const label = `suite "${suiteId}"`;
  if (!Array.isArray(attempts) || attempts.length === 0) {
    errors.push(`${label} must record at least one completed attempt`);
    return null;
  }
  let completed = 0;
  let failed = false;
  let oldest = null;
  let previousFinishedAt = null;
  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
    const where = `${label} attempt at index ${index}`;
    if (!isPlainObject(attempt)) {
      errors.push(`${where} must be an object`);
      continue;
    }
    if (!Number.isInteger(attempt.exitCode)) {
      errors.push(`${where} must have an integer exitCode`);
      continue;
    }
    const startedAt = parseTimestamp(attempt.startedAt);
    const finishedAt = parseTimestamp(attempt.finishedAt);
    if (startedAt === null) errors.push(`${where} startedAt must be a finite timestamp`);
    if (finishedAt === null) errors.push(`${where} finishedAt must be a finite timestamp`);
    if (startedAt !== null && finishedAt !== null) {
      completed += 1;
      if (finishedAt < startedAt) errors.push(`${where} finishedAt must not be before startedAt`);
      if (previousFinishedAt !== null && startedAt < previousFinishedAt) {
        errors.push(`${where} overlaps or is out of order with the previous attempt`);
      }
      previousFinishedAt = finishedAt;
      const beforeWindow = window.start !== null && startedAt < window.start;
      const afterWindow = window.finish !== null && finishedAt > window.finish;
      if (beforeWindow || afterWindow) errors.push(`${where} is outside the evidence window`);
      if (now !== null && (startedAt > now || finishedAt > now)) {
        errors.push(`${where} timestamps must not be in the future`);
      }
      if (oldest === null || startedAt < oldest) oldest = startedAt;
    }
    if (attempt.exitCode !== 0) failed = true;
  }
  if (completed === 0) errors.push(`${label} must record at least one completed attempt`);
  if (failed) {
    errors.push(
      `${label} has a failed attempt; a release cannot be attested from a retry after failure`,
    );
  }
  return oldest;
}

function validateSuites(suites, expectedById, window, now, errors) {
  if (!isPlainObject(suites)) {
    errors.push("evidence.suites must be an object keyed by suite id");
    return null;
  }
  for (const suiteId of REQUIRED_SUITE_IDS) {
    if (!Object.hasOwn(suites, suiteId)) {
      errors.push(`evidence.suites is missing required suite "${suiteId}"`);
    }
  }
  for (const suiteId of Object.keys(suites)) {
    if (!REQUIRED_SUITE_IDS.includes(suiteId)) {
      errors.push(`evidence.suites contains unexpected suite "${suiteId}"`);
    }
  }
  let oldest = null;
  for (const suiteId of REQUIRED_SUITE_IDS) {
    if (!Object.hasOwn(suites, suiteId)) continue;
    const suite = suites[suiteId];
    if (!isPlainObject(suite)) {
      errors.push(`suite "${suiteId}" must be an object`);
      continue;
    }
    validateCases(suiteId, suite.cases, expectedById?.get(suiteId) ?? null, errors);
    const suiteOldest = validateAttempts(suiteId, suite.attempts, window, now, errors);
    if (suiteOldest !== null && (oldest === null || suiteOldest < oldest)) oldest = suiteOldest;
  }
  return oldest;
}

function validateCompetitors(competitors, errors) {
  if (competitors === undefined) return;
  if (!Array.isArray(competitors)) {
    errors.push("evidence.competitors must be an array when present");
    return;
  }
  competitors.forEach((competitor, index) => {
    const label = `evidence.competitors[${index}]`;
    if (!isPlainObject(competitor)) {
      errors.push(`${label} must be an object`);
      return;
    }
    if (!isNonEmptyString(competitor.id)) errors.push(`${label} must have a non-empty string id`);
    if (!isNonEmptyString(competitor.reason)) errors.push(`${label} must give an explicit reason`);
  });
}

function validateModelSettings(model, errors) {
  if (model === undefined) return;
  if (!isPlainObject(model)) {
    errors.push("evidence.model must be an object when present");
    return;
  }
  for (const key of Object.keys(model)) {
    if (!ALLOWED_MODEL_FIELDS.includes(key)) {
      errors.push(`evidence.model has unsupported field "${key}"`);
    } else if (!isNonEmptyString(model[key])) {
      errors.push(`evidence.model.${key} must be a non-empty string`);
    }
  }
}

function validateEvidence(evidence, options, errors) {
  const now = options.now === undefined ? Date.now() : parseTimestamp(options.now);
  if (now === null) errors.push("options.now must be a finite timestamp");
  const maxAgeHours =
    options.maxAgeHours === undefined ? DEFAULT_MAX_AGE_HOURS : options.maxAgeHours;
  const windowMs =
    typeof maxAgeHours === "number" && Number.isFinite(maxAgeHours) && maxAgeHours > 0
      ? maxAgeHours * 60 * 60 * 1000
      : null;
  if (windowMs === null) errors.push("options.maxAgeHours must be a positive finite number");

  if (!isPlainObject(evidence)) {
    errors.push("evidence must be a plain object following release evidence schema v1");
    return;
  }
  if (evidence.schemaVersion !== EVIDENCE_SCHEMA_VERSION) {
    errors.push(`evidence.schemaVersion must be ${EVIDENCE_SCHEMA_VERSION}`);
  }
  validateCandidate(evidence.candidate, options.candidate, errors);

  const start = parseTimestamp(evidence.startedAt);
  const finish = parseTimestamp(evidence.finishedAt);
  if (start === null) errors.push("evidence.startedAt must be a finite timestamp");
  if (finish === null) errors.push("evidence.finishedAt must be a finite timestamp");
  if (start !== null && finish !== null) {
    if (finish < start) errors.push("evidence.finishedAt must not be before evidence.startedAt");
    if (now !== null && start > now) errors.push("evidence.startedAt must not be in the future");
    if (now !== null && finish > now) errors.push("evidence.finishedAt must not be in the future");
  }

  const oldest = validateSuites(
    evidence.suites,
    expectedCaseSets(options.expectedCaseIds, errors),
    { start, finish },
    now,
    errors,
  );
  if (now !== null && windowMs !== null) {
    if (finish !== null && finish <= now && now - finish > windowMs) {
      errors.push("evidence is older than the release evidence window");
    }
    if (oldest !== null && oldest <= now && now - oldest > windowMs) {
      errors.push("the oldest required attempt is older than the release evidence window");
    }
  }
  validateCompetitors(evidence.competitors, errors);
  validateModelSettings(evidence.model, errors);
}

/**
 * Validate an untrusted release evidence record against a candidate identity.
 *
 * `options.expectedCaseIds` is required: the caller's independent per-suite
 * case-id collection, which the evidence set must match exactly.
 *
 * @param {unknown} evidence Untrusted schema v1 record.
 * @param {{ candidate?: object, now?: number|string|Date, maxAgeHours?: number,
 *   expectedCaseIds?: Record<string, string[]> }} [options]
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateReleaseEvidence(evidence, options = {}) {
  const errors = [];
  try {
    validateEvidence(evidence, isPlainObject(options) ? options : {}, errors);
  } catch {
    // Untrusted input must never crash the validator or leak values; report a
    // generic schema error instead of the caught exception's message.
    errors.push("evidence could not be validated against release evidence schema v1");
  }
  return { valid: errors.length === 0, errors };
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new Error(`git ${args[0]} failed: ${result.error.message}`);
  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    throw new Error(`git ${args[0]} failed${stderr ? `: ${stderr}` : ""}`);
  }
  return result.stdout;
}

function compareByBytes(a, b) {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

function listTrackedFiles(rootPath) {
  return git(rootPath, ["ls-files", "-z"])
    .split("\0")
    .filter((path) => path !== "" && !path.split("/").includes(".git"))
    .sort(compareByBytes);
}

function assertCleanTree(rootPath) {
  const status = git(rootPath, ["status", "--porcelain", "--untracked-files=all"]);
  if (status.trim() === "") return;
  const changes = status.split("\n").filter((line) => line.trim() !== "");
  throw new Error(
    `fingerprintCandidate requires a clean working tree for release evidence; found ${changes.length} tracked or untracked change(s). Commit or remove them (ignored evidence artifacts are allowed).`,
  );
}

function isCredentialShapedPath(path) {
  const basename = path.split("/").pop() || "";
  if (/^(\.git-credentials|\.netrc|id_rsa|id_dsa|id_ecdsa|id_ed25519)$/i.test(basename)) {
    return true;
  }
  if (/^(credentials?|secrets?)(\..+)?$/i.test(basename)) return true;
  if (/\.(pem|key|p12|pfx|keystore|jks)$/i.test(basename)) return true;
  if (basename.toLowerCase() === ".env") return true;
  const envTemplate = basename.match(/^\.env\.(.+)$/i);
  return envTemplate !== null && !SAFE_ENV_TEMPLATES.includes(envTemplate[1].toLowerCase());
}

function assertNoCredentialTrackedFiles(paths) {
  if (paths.some(isCredentialShapedPath)) {
    throw new Error(
      "fingerprintCandidate refuses to fingerprint a repository that tracks a credential-shaped file; remove tracked secrets before producing release evidence",
    );
  }
}

function readTrackedEntry(rootPath, relPath) {
  const absolute = resolve(rootPath, relPath);
  const escaped = relative(rootPath, absolute);
  if (escaped.startsWith("..") || isAbsolute(escaped)) {
    throw new Error(
      `fingerprintCandidate refused a tracked path outside the repository: ${relPath}`,
    );
  }
  if (lstatSync(absolute).isSymbolicLink()) {
    // Hash the link target rather than following it, so a tracked symlink can
    // never pull an external file (or credential) into the digest.
    return Buffer.from(`symlink:${readlinkSync(absolute)}`, "utf8");
  }
  return readFileSync(absolute);
}

function hashEntries(entries) {
  const hash = createHash("sha256");
  for (const entry of entries) {
    const pathBuffer = Buffer.from(entry.path, "utf8");
    const content = Buffer.isBuffer(entry.content)
      ? entry.content
      : Buffer.from(String(entry.content), "utf8");
    hash.update(`path:${pathBuffer.length}:`);
    hash.update(pathBuffer);
    hash.update(`content:${content.length}:`);
    hash.update(content);
    hash.update(";");
  }
  return `sha256:${hash.digest("hex")}`;
}

function isPolicyPath(path) {
  if (POLICY_VITEST_FILES.has(path)) return true;
  if (path.startsWith("tests/scripts/")) return true;
  return path.startsWith("tests/evals/") && !path.startsWith("tests/evals/runs/");
}

function digestPolicy(rootPath, trackedPaths) {
  const packageJson = JSON.parse(readTrackedEntry(rootPath, "package.json").toString("utf8"));
  const scripts = isPlainObject(packageJson?.scripts) ? packageJson.scripts : {};
  const canonical = {};
  for (const key of Object.keys(scripts).sort(compareByBytes)) canonical[key] = scripts[key];
  const entries = [
    { path: "package.json#scripts", content: Buffer.from(JSON.stringify(canonical), "utf8") },
  ];
  for (const path of trackedPaths) {
    if (isPolicyPath(path)) entries.push({ path, content: readTrackedEntry(rootPath, path) });
  }
  entries.sort((a, b) => compareByBytes(a.path, b.path));
  return hashEntries(entries);
}

/**
 * Fingerprint a candidate release tree. Requires a clean working tree (ignored
 * artifacts are allowed) and fails closed on a tracked credential-shaped file.
 *
 * @param {string} root Repository root.
 * @returns {{ commit: string, sourceDigest: string, lockDigest: string, policyDigest: string }}
 */
export function fingerprintCandidate(root) {
  if (!isNonEmptyString(root)) {
    throw new TypeError("fingerprintCandidate(root) requires a non-empty root path");
  }
  const rootPath = resolve(root);
  const commit = git(rootPath, ["rev-parse", "HEAD"]).trim();
  if (!/^[0-9a-f]{40,64}$/i.test(commit)) {
    throw new Error("fingerprintCandidate could not resolve a git commit for the repository root");
  }
  assertCleanTree(rootPath);
  const trackedPaths = listTrackedFiles(rootPath);
  const trackedSet = new Set(trackedPaths);
  assertNoCredentialTrackedFiles(trackedPaths);
  if (!trackedSet.has("package.json")) {
    throw new Error("fingerprintCandidate requires a tracked package.json for the policy digest");
  }
  if (!trackedSet.has("package-lock.json")) {
    throw new Error(
      "fingerprintCandidate requires a tracked package-lock.json for the lock digest",
    );
  }
  const sourceEntries = trackedPaths.map((path) => ({
    path,
    content: readTrackedEntry(rootPath, path),
  }));
  return {
    commit,
    sourceDigest: hashEntries(sourceEntries),
    lockDigest: hashEntries([
      { path: "package-lock.json", content: readTrackedEntry(rootPath, "package-lock.json") },
    ]),
    policyDigest: digestPolicy(rootPath, trackedPaths),
  };
}
