/**
 * Small shared helpers for live e2e canaries (broad tool canary and provider
 * release smoke).
 *
 * Responsibilities:
 *  - explicit pass / fail / skip outcomes (no early-return-as-pass),
 *  - exit-code policy: default allows only explicitly-optional skips while a
 *    required core case passed; strict mode fails any skip,
 *  - redaction + run-summary path assembly for the provider release smoke,
 *  - pure payload verifiers for the release smoke, testable without live APIs.
 *
 * This is intentionally not a framework: callers build their own small case
 * lists and pass them to `runCases`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type CanaryOutcome = "passed" | "failed" | "skipped";

export interface CanaryCaseResult {
  name: string;
  outcome: CanaryOutcome;
  optional: boolean;
  reason?: string;
  durationMs: number;
}

export interface CanaryCounts {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  corePassed: number;
  coreSkipped: number;
  optionalSkipped: number;
}

export interface CanaryCase {
  name: string;
  optional?: boolean;
  run: () => Promise<void>;
}

/** Thrown by `skip()` to mark a known environment limitation, not a pass. */
export class SkipSignal extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "SkipSignal";
  }
}

/** Exit the current case as an explicit skip with a visible reason. */
export function skip(reason: string): never {
  throw new SkipSignal(reason);
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class CanaryResults {
  private readonly results: CanaryCaseResult[] = [];

  add(result: CanaryCaseResult): void {
    this.results.push(result);
  }

  all(): readonly CanaryCaseResult[] {
    return this.results;
  }

  counts(): CanaryCounts {
    const passed = this.results.filter((result) => result.outcome === "passed");
    const failed = this.results.filter((result) => result.outcome === "failed");
    const skipped = this.results.filter((result) => result.outcome === "skipped");
    const coreSkipped = skipped.filter((result) => !result.optional).length;
    return {
      total: this.results.length,
      passed: passed.length,
      failed: failed.length,
      skipped: skipped.length,
      corePassed: passed.filter((result) => !result.optional).length,
      coreSkipped,
      optionalSkipped: skipped.length - coreSkipped,
    };
  }

  /**
   * 1 when any case failed, when strict mode is set and anything was skipped,
   * when a required core case was skipped, or when no core case passed.
   * 0 permits only explicitly-optional skips alongside core passes.
   */
  exitCode(options: { requireAll?: boolean } = {}): number {
    const counts = this.counts();
    if (counts.failed > 0) return 1;
    if (options.requireAll && counts.skipped > 0) return 1;
    if (counts.coreSkipped > 0) return 1;
    if (counts.corePassed === 0) return 1;
    return 0;
  }

  formatSummary(): string {
    const counts = this.counts();
    const lines = [
      `Results: ${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped (of ${counts.total})`,
    ];
    if (counts.failed > 0) {
      lines.push("Failures:");
      for (const result of this.results) {
        if (result.outcome === "failed") {
          lines.push(`  ✗ ${result.name}: ${result.reason ?? "unknown error"}`);
        }
      }
    }
    if (counts.skipped > 0) {
      lines.push("Skipped:");
      for (const result of this.results) {
        if (result.outcome === "skipped") {
          lines.push(
            `  ⊘ ${result.name}${result.optional ? " [optional]" : ""}: ${result.reason ?? "skipped"}`,
          );
        }
      }
    }
    if (counts.failed === 0 && counts.skipped === 0 && counts.passed > 0) {
      lines.push("All tests passed!");
    }
    return lines.join("\n");
  }
}

/** Run cases sequentially, recording explicit pass/fail/skip outcomes. */
export async function runCases(
  cases: readonly CanaryCase[],
  options: { onResult?: (result: CanaryCaseResult) => void } = {},
): Promise<CanaryResults> {
  const results = new CanaryResults();
  for (const canaryCase of cases) {
    const startedAt = Date.now();
    let record: CanaryCaseResult;
    try {
      await canaryCase.run();
      record = {
        name: canaryCase.name,
        outcome: "passed",
        optional: canaryCase.optional === true,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      record = {
        name: canaryCase.name,
        outcome: error instanceof SkipSignal ? "skipped" : "failed",
        optional: canaryCase.optional === true,
        reason: messageOf(error),
        durationMs: Date.now() - startedAt,
      };
    }
    results.add(record);
    options.onResult?.(record);
  }
  return results;
}

/** `--require-all` on the command line or OPENCANDLE_CANARY_REQUIRE_ALL=1. */
export function resolveStrictMode(
  argv: readonly string[] = process.argv.slice(2),
  env: Record<string, string | undefined> = process.env,
): boolean {
  return argv.includes("--require-all") || env.OPENCANDLE_CANARY_REQUIRE_ALL === "1";
}

export function createRunId(now: Date = new Date()): string {
  return `${now.toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
}

export function resolveSummaryPath(baseDir: string, runId: string): string {
  return join(baseDir, "validation-output", "provider-release", runId, "summary.json");
}

export function writeSummaryFile(path: string, payload: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
}

/** Redact URL-embedded credentials and long opaque tokens before persisting. */
export function redactReason(text: string, maxLength = 200): string {
  return text
    .replace(/([?&](?:apikey|api_key|token|key|access_key)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[redacted]")
    .slice(0, maxLength);
}

export interface PayloadVerdict {
  status: "passed" | "failed";
  reason?: string;
}

function failed(reason: string): PayloadVerdict {
  return { status: "failed", reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidAsOf(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() === "") return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return true;
  return Number.isFinite(Date.parse(value));
}

/**
 * Release-smoke verifier for `get_stock_quote` details:
 * positive finite price, non-empty currency, valid provenance, and not
 * stale-as-live. No fixed expected price.
 */
export function verifyQuotePayload(details: unknown): PayloadVerdict {
  if (!isRecord(details)) return failed("quote details missing or not an object");
  if (typeof details.price !== "number" || !Number.isFinite(details.price) || details.price <= 0) {
    return failed("quote price is not a positive finite number");
  }
  if (typeof details.currency !== "string" || details.currency.trim() === "") {
    return failed("quote currency is missing");
  }
  if (!isRecord(details.freshness)) return failed("quote freshness metadata is missing");
  const freshness = details.freshness;
  const provenance = freshness.providerDataAt ?? freshness.providerDataDate;
  if (!isValidAsOf(provenance))
    return failed("quote provenance as-of timestamp is missing or invalid");
  if (freshness.cacheStatus === "stale")
    return failed("quote is stale-as-live (cacheStatus=stale)");
  if (freshness.isStaleForSession === true) {
    return failed("quote is stale for the current market session");
  }
  return { status: "passed" };
}

/**
 * Release-smoke verifier for `get_stock_history` details:
 * a non-empty array of bars with positive finite OHLC, finite non-negative
 * volume, OHLC structural bounds, and strictly increasing days across one
 * finite epoch domain (date-only, timestamp, and mixed representations).
 * A stale-history object or empty array is rejected so a stale/unavailable
 * payload cannot pass as live.
 */
const MS_PER_DAY = 86_400_000;

function utcDayStart(epochMs: number): number {
  return Math.floor(epochMs / MS_PER_DAY) * MS_PER_DAY;
}

interface HistoryBarEpoch {
  dayStart: number;
}

function normalizeHistoryEpoch(
  bar: Record<string, unknown>,
  index: number,
): HistoryBarEpoch | PayloadVerdict {
  const { timestamp, date } = bar;
  let timestampEpoch: number | undefined;
  if (timestamp !== undefined) {
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp <= 0) {
      return failed(`history bar ${index} has an invalid timestamp`);
    }
    timestampEpoch = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
  }

  let dateEpoch: number | undefined;
  if (date !== undefined) {
    if (typeof date !== "string" || date.trim() === "") {
      return failed(`history bar ${index} has an invalid date`);
    }
    dateEpoch = /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? Date.parse(`${date}T00:00:00.000Z`)
      : Date.parse(date);
    if (!Number.isFinite(dateEpoch)) return failed(`history bar ${index} has an invalid date`);
  }

  if (timestampEpoch === undefined && dateEpoch === undefined) {
    return failed(`history bar ${index} is missing both date and timestamp`);
  }
  if (
    timestampEpoch !== undefined &&
    dateEpoch !== undefined &&
    utcDayStart(timestampEpoch) !== utcDayStart(dateEpoch)
  ) {
    return failed(`history bar ${index} date and timestamp disagree`);
  }

  return { dayStart: utcDayStart(timestampEpoch ?? (dateEpoch as number)) };
}

export function verifyHistoryPayload(details: unknown): PayloadVerdict {
  if (!Array.isArray(details)) {
    return failed("history details is not an array of live bars (stale or unavailable)");
  }
  if (details.length === 0) return failed("history payload is empty");

  let previousDay: number | undefined;
  for (const [index, bar] of details.entries()) {
    if (!isRecord(bar)) return failed(`history bar ${index} is not an object`);

    const { open, high, low, close } = bar;
    if (typeof open !== "number" || !Number.isFinite(open) || open <= 0) {
      return failed(`history bar ${index} has an invalid open`);
    }
    if (typeof high !== "number" || !Number.isFinite(high) || high <= 0) {
      return failed(`history bar ${index} has an invalid high`);
    }
    if (typeof low !== "number" || !Number.isFinite(low) || low <= 0) {
      return failed(`history bar ${index} has an invalid low`);
    }
    if (typeof close !== "number" || !Number.isFinite(close) || close <= 0) {
      return failed(`history bar ${index} has an invalid close`);
    }
    if (typeof bar.volume !== "number" || !Number.isFinite(bar.volume) || bar.volume < 0) {
      return failed(`history bar ${index} has an invalid volume`);
    }
    if (high < Math.max(open, close, low)) {
      return failed(`history bar ${index} high is below open/close/low`);
    }
    if (low > Math.min(open, close, high)) {
      return failed(`history bar ${index} low is above open/close/high`);
    }

    const epoch = normalizeHistoryEpoch(bar, index);
    if ("status" in epoch) return epoch;
    if (previousDay !== undefined && epoch.dayStart <= previousDay) {
      return failed(`history bars are not strictly increasing at index ${index}`);
    }
    previousDay = epoch.dayStart;
  }
  return { status: "passed" };
}
