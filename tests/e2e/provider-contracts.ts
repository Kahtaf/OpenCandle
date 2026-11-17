import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, resetConfigCache } from "../../src/config.js";
import { runWithAbortSignal } from "../../src/infra/abort-context.js";
import { cache } from "../../src/infra/cache.js";
import {
  type CanaryCase,
  type CanaryCaseResult,
  CanaryResults,
  createRunId,
  redactReason,
  runCases,
  writeSummaryFile,
} from "./live-canary-results.js";

const groups = {
  market: async () => (await import("./provider-contract-market.js")).getMarketContractCases(),
  macro: async () => (await import("./provider-contract-macro.js")).getMacroContractCases(),
  search: async () => (await import("./provider-contract-search.js")).getSearchContractCases(),
};

const startedAt = new Date().toISOString();
const summaryPath = join("validation-output", "provider-contracts", createRunId(), "summary.json");
const results = new CanaryResults();
let selectedNames: string[] = [];
let candidateCommit: string | undefined;
let worktreeDirty: boolean | undefined;
let finished = false;

function save(): void {
  writeSummaryFile(summaryPath, {
    candidateCommit,
    worktreeDirty,
    startedAt,
    finishedAt: finished ? new Date().toISOString() : null,
    status: finished ? "completed" : "running",
    selected: selectedNames,
    counts: results.counts(),
    results: results.all(),
    exitCode: finished ? results.exitCode({ requireAll: true }) : null,
  });
}

function record(result: CanaryCaseResult): void {
  const sanitized = {
    ...result,
    ...(result.reason ? { reason: redactReason(result.reason) } : {}),
  };
  results.add(sanitized);
  save();
  process.stdout.write(
    `${sanitized.outcome}: ${sanitized.name}${sanitized.reason ? ` (${sanitized.reason})` : ""}\n`,
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const selectedGroups: Array<keyof typeof groups> = [];
  const requestedCases: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[++index];
    if (arg === "--group" && value && Object.hasOwn(groups, value)) {
      selectedGroups.push(value as keyof typeof groups);
    } else if (arg === "--case" && value) {
      requestedCases.push(value);
    } else {
      throw new Error(
        "Usage: provider-contracts.ts [--group market|macro|search] [--case exact-name]",
      );
    }
  }
  candidateCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  worktreeDirty =
    execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0;
  const config = loadConfig();
  for (const [name, value] of Object.entries({
    ALPHA_VANTAGE_API_KEY: config.alphaVantageApiKey,
    FRED_API_KEY: config.fredApiKey,
    FINNHUB_API_KEY: config.finnhubApiKey,
    BRAVE_API_KEY: config.braveApiKey,
    EXA_API_KEY: config.exaApiKey,
    LSE_API_KEY: config.lseApiKey,
  })) {
    if (value !== undefined) process.env[name] ??= value;
  }
  const home = mkdtempSync(join(tmpdir(), "oc-provider-contracts-"));
  process.env.OPENCANDLE_HOME = home;
  resetConfigCache();
  process.on("exit", () => rmSync(home, { recursive: true, force: true }));
  const cases: CanaryCase[] = [];
  for (const group of new Set(selectedGroups.length ? selectedGroups : Object.keys(groups))) {
    cases.push(...(await groups[group as keyof typeof groups]()));
  }
  const names = new Set(cases.map((entry) => entry.name));
  if (names.size !== cases.length) throw new Error("Duplicate provider contract case names");
  for (const name of requestedCases) {
    if (!names.has(name)) throw new Error(`Unknown provider contract case: ${name}`);
  }
  const selected = requestedCases.length
    ? cases.filter((entry) => requestedCases.includes(entry.name))
    : cases;
  if (selected.length === 0) throw new Error("No provider contract cases selected");
  selectedNames = selected.map((entry) => entry.name);
  save();
  const abort = new AbortController();
  const timeout = setTimeout(() => {
    abort.abort();
    const completed = new Set(results.all().map((result) => result.name));
    for (const name of selectedNames) {
      if (!completed.has(name)) {
        record({
          name,
          outcome: "failed",
          optional: false,
          durationMs: 0,
          reason: "Run timed out before this case completed",
        });
      }
    }
    finished = true;
    save();
    process.exit(1);
  }, 12 * 60_000);
  try {
    await runWithAbortSignal(abort.signal, () =>
      runCases(
        selected.map((entry) => ({
          ...entry,
          optional: false,
          run: async () => {
            cache.clear();
            await entry.run();
          },
        })),
        { onResult: record },
      ),
    );
  } finally {
    clearTimeout(timeout);
  }
  finished = true;
  save();
  process.stdout.write(`${results.formatSummary()}\nEvidence: ${summaryPath}\n`);
  process.exit(results.exitCode({ requireAll: true }));
}

main().catch((error: unknown) => {
  finished = true;
  record({
    name: "provider-contracts:setup",
    outcome: "failed",
    optional: false,
    durationMs: 0,
    reason: error instanceof Error ? error.message : "Unknown setup failure",
  });
  process.exit(1);
});
