#!/usr/bin/env tsx
/**
 * Provider release smoke — bounded, credential/runtime-gated live check.
 *
 * Runs exactly the two selected core checks against the real registered tools
 * (no provider internal mocks):
 *   1. get_stock_quote  (AAPL)
 *   2. get_stock_history (AAPL, 1mo, 1d)
 *
 * Requirements:
 *  - a temporary OPENCANDLE_HOME is installed before `loadConfig()` runs (the
 *    sole static `src` import, `infra/cache`, has no config dependency), and
 *    the original home is restored in a `finally`;
 *  - the cache is cleared before each check so cached data cannot pass as live;
 *  - quote must have a positive finite price, non-empty currency, valid
 *    as-of/provenance, and not be stale-as-live;
 *  - history must be a non-empty array of bars with positive finite OHLC,
 *    finite non-negative volume, OHLC structural bounds, and strictly
 *    increasing days (no stale object / empty array / duplicate day);
 *  - the whole run is bounded by a 120s total timeout and any
 *    missing/failed/skipped/nonzero case blocks (exit 1);
 *  - the candidate commit is resolved from git and recorded for release
 *    evidence; an unavailable commit is a failed check;
 *  - a redacted `validation-output/provider-release/<run>/summary.json` is
 *    always written (status/duration/provider/fixtureVersion/candidateCommit/
 *    startedAt/finishedAt; never raw market responses or credentials).
 *
 * Timeout limitation: `Promise.race` cannot cancel in-flight provider work.
 * The CLI entrypoint below terminates the process with `process.exit`, so the
 * 120s bound holds for `tsx tests/e2e/provider-release-smoke.ts`. Callers that
 * import `runProviderReleaseSmoke` instead must bound or abort the process
 * themselves, since the losing race is left running.
 *
 * Usage: `tsx tests/e2e/provider-release-smoke.ts`
 * No fixed financial expected numbers and no freshness window heuristic are
 * used; the existing freshness metadata contract decides staleness.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { cache } from "../../src/infra/cache.js";
import {
  CanaryResults,
  createRunId,
  messageOf,
  redactReason,
  resolveSummaryPath,
  runCases,
  verifyHistoryPayload,
  verifyQuotePayload,
  writeSummaryFile,
} from "./live-canary-results.js";

export const TOTAL_TIMEOUT_MS = 120_000;
export const RUN_SCOPE = "core" as const;
export const PRIMARY_PROVIDER = "yahoo" as const;
export const SMOKE_SYMBOL = "AAPL";
export const FIXTURE_VERSION = "none" as const;

export interface SmokeToolLike {
  execute(
    toolCallId: string,
    args: Record<string, unknown>,
  ): Promise<{ content: unknown; details: unknown }>;
}

function findRegisteredTool<T extends { name: string }>(tools: readonly T[], name: string): T {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`registered tool missing: ${name}`);
  return tool;
}

/**
 * Resolve the commit under test for release evidence. Returns null when git is
 * unavailable or the directory is not a repository; the caller records that as
 * a failed check, because release evidence must be correlatable to a commit.
 */
export function resolveCandidateCommit(cwd: string = process.cwd()): string | null {
  try {
    const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf-8" });
    if (result.status !== 0) return null;
    const commit = (result.stdout ?? "").trim();
    return /^[0-9a-f]{40}$/i.test(commit) ? commit.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function buildReleaseSmokeCases(
  quoteTool: SmokeToolLike,
  historyTool: SmokeToolLike,
): Array<{ name: string; optional: boolean; run: () => Promise<void> }> {
  return [
    {
      name: `get_stock_quote:${SMOKE_SYMBOL}`,
      optional: false,
      run: async () => {
        cache.clear();
        const result = await quoteTool.execute("provider-release-smoke", { symbol: SMOKE_SYMBOL });
        const verdict = verifyQuotePayload(result.details);
        if (verdict.status !== "passed") throw new Error(verdict.reason);
      },
    },
    {
      name: `get_stock_history:${SMOKE_SYMBOL}`,
      optional: false,
      run: async () => {
        cache.clear();
        const result = await historyTool.execute("provider-release-smoke", {
          symbol: SMOKE_SYMBOL,
          range: "1mo",
          interval: "1d",
        });
        const verdict = verifyHistoryPayload(result.details);
        if (verdict.status !== "passed") throw new Error(verdict.reason);
      },
    },
  ];
}

function renderCase(result: {
  name: string;
  outcome: string;
  durationMs: number;
  reason?: string;
}) {
  const mark = result.outcome === "passed" ? "✓" : result.outcome === "skipped" ? "⊘" : "✗";
  const reason = result.reason ? `: ${redactReason(result.reason)}` : "";
  return `  ${mark} ${result.name} (${result.durationMs}ms)${reason}`;
}

export interface ProviderReleaseSmokeOptions {
  baseDir?: string;
  now?: Date;
}

export interface ProviderReleaseSmokeOutcome {
  exitCode: number;
  summaryPath: string;
}

export async function runProviderReleaseSmoke(
  options: ProviderReleaseSmokeOptions = {},
): Promise<ProviderReleaseSmokeOutcome> {
  const baseDir = options.baseDir ?? process.cwd();
  const runId = createRunId(options.now);
  const summaryPath = resolveSummaryPath(baseDir, runId);
  const startedAt = new Date().toISOString();
  const results = new CanaryResults();
  let timedOut = false;

  const originalHome = process.env.OPENCANDLE_HOME;
  const tempHome = mkdtempSync(join(tmpdir(), "opencandle-provider-release-"));
  process.env.OPENCANDLE_HOME = tempHome;

  let fatal = false;

  try {
    // Dynamic import so the temporary home is in place before loadConfig().
    const { getAllTools } = await import("../../src/tools/index.js");
    const tools = getAllTools();
    const quoteTool = findRegisteredTool(tools, "get_stock_quote");
    const historyTool = findRegisteredTool(tools, "get_stock_history");
    const cases = buildReleaseSmokeCases(quoteTool, historyTool);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`total timeout after ${TOTAL_TIMEOUT_MS}ms`)),
        TOTAL_TIMEOUT_MS,
      );
      (timer as { unref?: () => void }).unref?.();
    });

    try {
      const run = await Promise.race([
        runCases(cases, { onResult: (result) => console.log(renderCase(result)) }),
        timeout,
      ]);
      for (const result of run.all()) results.add(result);
    } catch (error) {
      const reason = messageOf(error);
      if (reason.includes("total timeout")) timedOut = true;
      else fatal = true;
      results.add({
        name: "provider-release-smoke",
        outcome: "failed",
        optional: false,
        reason: redactReason(reason),
        durationMs: timedOut ? TOTAL_TIMEOUT_MS : 0,
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (error) {
    fatal = true;
    results.add({
      name: "provider-release-smoke:setup",
      outcome: "failed",
      optional: false,
      reason: redactReason(messageOf(error)),
      durationMs: 0,
    });
  } finally {
    if (originalHome === undefined) delete process.env.OPENCANDLE_HOME;
    else process.env.OPENCANDLE_HOME = originalHome;
    rmSync(tempHome, { recursive: true, force: true });
  }

  const candidateCommit = resolveCandidateCommit(baseDir);
  if (candidateCommit === null) {
    results.add({
      name: "provider-release-smoke:candidate-commit",
      outcome: "failed",
      optional: false,
      reason: "candidate commit unavailable (git rev-parse HEAD failed)",
      durationMs: 0,
    });
  }
  const finishedAt = new Date().toISOString();

  const counts = results.counts();
  writeSummaryFile(summaryPath, {
    runId,
    candidateCommit,
    startedAt,
    finishedAt,
    scope: RUN_SCOPE,
    symbol: SMOKE_SYMBOL,
    provider: PRIMARY_PROVIDER,
    fixtureVersion: FIXTURE_VERSION,
    strict: true,
    timedOut,
    fatal,
    totals: counts,
    cases: results.all().map((result) => ({
      name: result.name,
      status: result.outcome,
      durationMs: result.durationMs,
      provider: PRIMARY_PROVIDER,
      fixtureVersion: FIXTURE_VERSION,
      ...(result.reason ? { reason: redactReason(result.reason) } : {}),
    })),
  });

  console.log(results.formatSummary());
  return { exitCode: results.exitCode({ requireAll: true }), summaryPath };
}

const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  runProviderReleaseSmoke()
    .then(({ exitCode, summaryPath }) => {
      console.log(`summary: ${summaryPath}`);
      process.exit(exitCode);
    })
    .catch((error) => {
      console.error(`provider-release-smoke fatal: ${redactReason(messageOf(error))}`);
      process.exit(1);
    });
}
