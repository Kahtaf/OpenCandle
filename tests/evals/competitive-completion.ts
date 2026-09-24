import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CompletionReportCase } from "./completion-report.js";
import type { FinalAnswerAssertionResult } from "./prompt-policy-assertions.js";

/**
 * Narrow release escape hatch for prompt/competitor cache reuse. With
 * `OPENCANDLE_COMPETITIVE_NO_CACHE=1` the competitive cache is empty, so a
 * release run cannot treat a cached competitor answer or prompt metadata as a
 * fresh observation. Ordinary (non-release) discovery runs keep their existing
 * cache behavior unchanged.
 */
export function selectCompetitiveReportCache<T>(env: NodeJS.ProcessEnv, load: () => T[]): T[] {
  return env.OPENCANDLE_COMPETITIVE_NO_CACHE === "1" ? [] : load();
}

export const COMPETITOR_SKIP_METADATA_VERSION = 1;
export const COMPETITOR_SKIP_METADATA_SUFFIX = ".competitors.json";

// Closed known competitor ids plus a conservative fallback shape; a name that
// is neither is rejected rather than carried as opaque release evidence.
const KNOWN_COMPETITOR_IDS = new Set(["claude", "codex", "gemini"]);
const SAFE_COMPETITOR_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export interface CompetitorSkipMetadata {
  version: 1;
  suite: string;
  skipped: Array<{ id: string; reason: string }>;
}

/**
 * Same-run competitor skip metadata, written beside the completion report.
 * Only `id` and a bounded `reason` are ever persisted; competitor answers,
 * prompts, and credentials never enter this file. The reader treats an absent
 * file as unknown, and a malformed one as an explicit error.
 */
export function competitorSkipMetadataPath(completionPath: string): string {
  return `${completionPath}${COMPETITOR_SKIP_METADATA_SUFFIX}`;
}

function safeCompetitorId(raw: unknown): string {
  const id = typeof raw === "string" ? raw.trim() : "";
  if (id === "") throw new Error("competitor skip metadata entry has no id");
  if (!KNOWN_COMPETITOR_IDS.has(id) && !SAFE_COMPETITOR_ID.test(id)) {
    throw new Error(`competitor skip metadata entry has an unsafe id: ${id}`);
  }
  return id;
}

function requiredReason(raw: unknown, id: string): string {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error(`competitor skip metadata entry "${id}" has no reason`);
  }
  return truncateReason(raw);
}

/** Writer-side strictness: malformed runner input fails instead of being guessed. */
export function buildCompetitorSkipMetadata(
  suite: string,
  skipped: readonly { id?: unknown; reason?: unknown }[],
): CompetitorSkipMetadata {
  const entries = skipped.map((skip) => {
    const id = safeCompetitorId(skip?.id);
    return { id, reason: requiredReason(skip?.reason, id) };
  });
  return { version: COMPETITOR_SKIP_METADATA_VERSION, suite, skipped: entries };
}

/**
 * Strict reader. Returns null when the record is malformed, the suite does not
 * match the caller's expected suite, or any entry has an unsafe id or a missing
 * / non-string reason — malformed evidence is never softened into a generic
 * reason.
 */
export function parseCompetitorSkipMetadata(
  value: unknown,
  expectedSuite: string,
): Array<{ id: string; reason: string }> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.version !== COMPETITOR_SKIP_METADATA_VERSION ||
    record.suite !== expectedSuite ||
    !Array.isArray(record.skipped)
  ) {
    return null;
  }
  const entries: Array<{ id: string; reason: string }> = [];
  for (const raw of record.skipped) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    const entry = raw as Record<string, unknown>;
    try {
      const id = safeCompetitorId(entry.id);
      entries.push({ id, reason: requiredReason(entry.reason, id) });
    } catch {
      return null;
    }
  }
  return entries;
}

export function writeCompetitorSkipMetadata(
  completionPath: string,
  suite: string,
  skipped: readonly { id?: unknown; reason?: unknown }[],
): string {
  const path = competitorSkipMetadataPath(completionPath);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(
      temporary,
      `${JSON.stringify(buildCompetitorSkipMetadata(suite, skipped), null, 2)}\n`,
      "utf-8",
    );
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
  return path;
}

/**
 * Builds the required completion case for a frozen competitive prompt.
 *
 * Only the manifest's required hard assertions participate here; optional
 * judge (non-deterministic) assertions stay separate and can never make the
 * case pass or fail. Every required assertion name must be unique and must be
 * present exactly once in `results` under the same name. A frozen prompt
 * passes only when every matched result is deterministic and passed. Missing,
 * extra, duplicate, or malformed assertions fail, and a required assertion
 * with no deterministic checker fails even when a sibling passed — an unknown
 * checker cannot hide behind a passing one.
 */
export function completionCaseForPrompt(
  id: string,
  requiredAssertions: readonly string[],
  results: readonly FinalAnswerAssertionResult[],
): CompletionReportCase {
  if (requiredAssertions.length === 0) {
    return fail(id, "no required hard assertions configured for frozen prompt");
  }
  const expectedNames = new Set<string>();
  for (const name of requiredAssertions) {
    if (typeof name !== "string" || name.trim() === "") {
      return fail(id, "malformed required assertion name");
    }
    if (expectedNames.has(name)) {
      return fail(id, `duplicate required assertion name: ${name}`);
    }
    expectedNames.add(name);
  }
  if (results.length !== requiredAssertions.length) {
    return fail(
      id,
      `hard assertion result count ${results.length} does not match ${requiredAssertions.length} configured required assertion(s)`,
    );
  }
  const resultNames = new Set<string>();
  for (const result of results) {
    if (typeof result.assertion !== "string" || result.assertion.trim() === "") {
      return fail(id, "malformed hard assertion result name");
    }
    if (resultNames.has(result.assertion)) {
      return fail(id, `duplicate hard assertion result name: ${result.assertion}`);
    }
    resultNames.add(result.assertion);
  }
  const missing = [...expectedNames].filter((name) => !resultNames.has(name));
  const unexpected = [...resultNames].filter((name) => !expectedNames.has(name));
  if (missing.length > 0 || unexpected.length > 0) {
    return fail(
      id,
      `hard assertion results do not match the required assertions (missing: ${
        missing.join(", ") || "none"
      }; unexpected: ${unexpected.join(", ") || "none"})`,
    );
  }
  const withoutChecker = results.filter((result) => !result.deterministic);
  if (withoutChecker.length > 0) {
    return fail(
      id,
      `required assertion(s) have no deterministic checker: ${withoutChecker
        .map((result) => result.assertion)
        .join("; ")}`,
    );
  }
  const failed = results.filter((result) => !result.passed);
  if (failed.length > 0) {
    return fail(
      id,
      `deterministic hard assertion(s) failed: ${failed
        .map((result) => result.assertion)
        .join("; ")}`,
    );
  }
  return { id, status: "passed" };
}

function fail(id: string, reason: string): CompletionReportCase {
  return { id, status: "failed", reason: truncateReason(reason) };
}

function truncateReason(reason: string): string {
  const collapsed = reason.replace(/\s+/g, " ").trim();
  return collapsed.length > 900 ? `${collapsed.slice(0, 899)}…` : collapsed;
}
