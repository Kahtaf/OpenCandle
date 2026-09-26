/**
 * Live e2e canary for OpenCandle tool functions with real API calls.
 *
 * Usage: npx tsx tests/e2e/tools.test.ts [--require-all]
 *
 * Outcome policy:
 *  - Every case records exactly one of passed / failed / skipped.
 *  - Known environment limitations (Reddit 403, missing/session-less external
 *    tools, Alpha Vantage rate limits/empty payloads, web-search providers
 *    unavailable) are recorded as an explicit SKIP with a reason — never as a
 *    silent pass.
 *  - Cases that depend on an optional provider key are always registered and
 *    skipped visibly when the key is absent, instead of being omitted.
 *  - Default exit code is 0 only when at least one required core case passed
 *    and nothing failed or core-skipped; `--require-all` (or
 *    OPENCANDLE_CANARY_REQUIRE_ALL=1) fails on any skip.
 *  - The summary never prints "All tests passed!" when anything was skipped.
 *
 * The temporary OPENCANDLE_HOME is installed before `loadConfig()` and the
 * original environment is restored (and the temp dir removed) even on failure.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getConfig, loadConfig } from "../../src/config.js";
import { scoreSentiment } from "../../src/providers/reddit.js";
import { searchFilings } from "../../src/providers/sec-edgar.js";
import { getHistory } from "../../src/providers/yahoo-finance.js";
import { SentimentStore } from "../../src/sentiment/store.js";
import { computeComps } from "../../src/tools/fundamentals/comps.js";
import { computeDCF } from "../../src/tools/fundamentals/dcf.js";
import { getAllTools } from "../../src/tools/index.js";
import { computeCorrelation } from "../../src/tools/portfolio/correlation.js";
import { runBacktest } from "../../src/tools/technical/backtest.js";
import { computeOBV, computeVWAP } from "../../src/tools/technical/indicators.js";
import { type CanaryCaseResult, resolveStrictMode, runCases, skip } from "./live-canary-results.js";

const strict = resolveStrictMode();

// Environment must be sandboxed before loadConfig() memoizes the config.
const originalHome = process.env.OPENCANDLE_HOME;
const openCandleHome = mkdtempSync(join(tmpdir(), "opencandle-tools-test-"));
process.env.OPENCANDLE_HOME = openCandleHome;

let cleanedUp = false;
function cleanup(): void {
  if (cleanedUp) return;
  cleanedUp = true;
  rmSync(openCandleHome, { recursive: true, force: true });
  if (originalHome === undefined) delete process.env.OPENCANDLE_HOME;
  else process.env.OPENCANDLE_HOME = originalHome;
}

try {
  loadConfig();
} catch (error) {
  cleanup();
  throw error;
}

const config = getConfig();
const tools = getAllTools();

function getTool(name: string) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function toolText(result: { content: Array<{ type: string; text?: string }> }): string {
  const first = result.content[0];
  return first?.type === "text" && first.text ? first.text : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const cases: Array<{ name: string; optional: boolean; run: () => Promise<void> }> = [];
function test(name: string, run: () => Promise<void>, options: { optional?: boolean } = {}): void {
  cases.push({ name, optional: options.optional === true, run });
}

// ---------------------------------------------------------------------------
// Core: config, pure math, registered tools that only need Yahoo/SEC/public
// ---------------------------------------------------------------------------

test("config: getConfig returns valid config", async () => {
  const current = getConfig();
  assert("alphaVantageApiKey" in current, "alphaVantageApiKey key missing");
  assert("fredApiKey" in current, "fredApiKey key missing");
});

test("indicators: computeOBV with real SPY data", async () => {
  const bars = await getHistory("SPY", "3mo", "1d");
  const obv = computeOBV(bars);
  assert(obv.length === bars.length, `OBV length ${obv.length} !== bars ${bars.length}`);
  assert(obv[0] === 0, "OBV[0] should be 0");
  assert(
    obv.filter((value) => value !== 0).length > 0,
    "OBV is all zeros — no volume movement detected",
  );
});

test("indicators: computeVWAP with real SPY data", async () => {
  const bars = await getHistory("SPY", "3mo", "1d");
  const vwap = computeVWAP(bars);
  assert(vwap.length === bars.length, "VWAP length mismatch");
  assert(vwap[0] > 0, "VWAP[0] should be positive");
  const lastPrice = bars[bars.length - 1].close;
  const lastVwap = vwap[vwap.length - 1];
  assert(
    lastVwap > lastPrice * 0.5 && lastVwap < lastPrice * 1.5,
    `VWAP $${lastVwap.toFixed(2)} is far from price $${lastPrice.toFixed(2)}`,
  );
});

test("indicators: get_technical_indicators includes OBV and VWAP", async () => {
  const tool = getTool("get_technical_indicators");
  const result = await tool.execute("e2e", { symbol: "SPY", range: "6mo" });
  const text = toolText(result);
  assert(text.includes("OBV"), "OBV missing from output text");
  assert(text.includes("VWAP"), "VWAP missing from output text");
  assert(result.details.obv.length > 0, "obv array empty in details");
  assert(result.details.vwap.length > 0, "vwap array empty in details");
});

test("sentiment: scoreSentiment pure function", async () => {
  const bullish = scoreSentiment([{ title: "AAPL to the moon! Buy the dip!" }]);
  assert(bullish.score > 0, `expected positive, got ${bullish.score}`);
  assert(bullish.bullish > 0, "bullish count should be > 0");

  const bearish = scoreSentiment([{ title: "Market crash incoming, sell everything" }]);
  assert(bearish.score < 0, `expected negative, got ${bearish.score}`);

  const neutral = scoreSentiment([{ title: "Earnings report next Tuesday" }]);
  assert(neutral.score === 0, `expected 0, got ${neutral.score}`);
});

test("fundamentals: computeDCF pure function with known inputs", async () => {
  const result = computeDCF({
    freeCashFlow: 100_000_000_000,
    growthRate: 0.08,
    discountRate: 0.1,
    terminalGrowth: 0.03,
    years: 5,
    netDebt: 50_000_000_000,
    sharesOutstanding: 15_000_000_000,
  });
  assert(result.intrinsicValue > 0, `intrinsic=${result.intrinsicValue}`);
  assert(result.projectedCashFlows.length === 5, "should have 5 projected years");
  assert(result.sensitivityTable.length > 0, "sensitivity table empty");
  assert(Array.isArray(result.warnings), "warnings not an array");
  const year1 = result.projectedCashFlows[0];
  assert(year1.presentValue > year1.fcf / 1.1 ** 1, "mid-year convention not applied");
});

test("fundamentals: computeDCF warns on narrow spread", async () => {
  const result = computeDCF({
    freeCashFlow: 1_000_000,
    growthRate: 0.05,
    discountRate: 0.06,
    terminalGrowth: 0.05,
    years: 5,
    netDebt: 0,
    sharesOutstanding: 1000,
  });
  assert(
    result.warnings.some((warning) => warning.toLowerCase().includes("terminal growth")),
    "missing terminal growth warning",
  );
});

test("fundamentals: computeComps includes p25/p75 percentiles", async () => {
  const company = (symbol: string, index: number) => ({
    symbol,
    name: symbol,
    description: "",
    exchange: "",
    sector: "",
    industry: "",
    marketCap: (index + 1) * 1e9,
    pe: (index + 1) * 10,
    forwardPe: (index + 1) * 9,
    eps: 6 - index,
    dividendYield: 0.02 - index * 0.005,
    beta: 0.8 + index * 0.3,
    week52High: 100 + index * 40,
    week52Low: 80 + index * 10,
    avgVolume: 1e6 * (index + 1),
    profitMargin: 0.2 + index * 0.05,
    revenueGrowth: 0.1 + index * 0.05,
  });
  const result = computeComps([company("A", 0), company("B", 1), company("C", 2)]);
  const pe = result.metrics.find((metric) => metric.metric === "P/E");
  assert(pe?.p25 != null, "p25 missing");
  assert(pe?.p75 != null, "p75 missing");
  assert(pe.p25! <= pe.median!, `p25 ${pe.p25} > median ${pe.median}`);
  assert(pe.p75! >= pe.median!, `p75 ${pe.p75} < median ${pe.median}`);
});

test("sec: searchFilings returns AAPL filings from EDGAR", async () => {
  const filings = await searchFilings("AAPL", ["10-K", "10-Q"], 5);
  assert(filings.length > 0, "no filings returned");
  assert(filings[0].formType.length > 0, `formType empty: ${filings[0].formType}`);
  assert(filings[0].filedDate.length > 0, "filedDate empty");
  assert(
    filings[0].entityName.toUpperCase().includes("APPLE"),
    `entityName: ${filings[0].entityName}`,
  );
  assert(filings[0].url.includes("sec.gov"), "URL should contain sec.gov");
});

test("sec: get_sec_filings tool on AAPL", async () => {
  const tool = getTool("get_sec_filings");
  const result = await tool.execute("e2e", { symbol: "AAPL", limit: 5 });
  const text = toolText(result);
  assert(
    text.includes("AAPL") || text.includes("Apple") || text.includes("APPLE"),
    "AAPL not in output",
  );
  if (result.details?.filings?.length > 0) {
    assert(result.details.filings[0].formType.length > 0, "formType empty");
  }
});

test("sec: get_sec_filings with invalid ticker returns gracefully", async () => {
  const tool = getTool("get_sec_filings");
  const result = await tool.execute("e2e", { symbol: "ZZZZNOTREAL999" });
  assert(toolText(result).length > 0, "empty response");
});

test("backtest: runBacktest SMA crossover on real SPY data", async () => {
  const bars = await getHistory("SPY", "2y", "1d");
  const result = runBacktest(bars, "sma_crossover");
  assert(typeof result.totalReturn === "number", "totalReturn not a number");
  assert(typeof result.buyAndHoldReturn === "number", "buyAndHoldReturn not a number");
  assert(result.maxDrawdown >= 0, "maxDrawdown should be >= 0");
  assert(result.trades >= 0, "trades should be >= 0");
});

test("backtest: runBacktest RSI mean-reversion on real AAPL data", async () => {
  const bars = await getHistory("AAPL", "2y", "1d");
  const result = runBacktest(bars, "rsi_mean_reversion");
  assert(result.strategy === "rsi_mean_reversion", "wrong strategy name");
});

test("backtest: backtest_strategy tool with insufficient data", async () => {
  const tool = getTool("backtest_strategy");
  const result = await tool.execute("e2e", {
    symbol: "SPY",
    strategy: "sma_crossover",
    period: "5d",
  });
  assert(toolText(result).length > 0, "empty response");
});

test("watchlist: create → add → check → remove", async () => {
  const tool = getTool("manage_watchlist");
  let result = await tool.execute("e2e", { action: "create", watchlist_name: "MAG7" });
  assert(toolText(result).includes("MAG7"), "create failed");

  result = await tool.execute("e2e", { action: "add", symbol: "AAPL", watchlist_name: "MAG7" });
  assert(toolText(result).includes("AAPL"), "add failed");
  const itemId = (result.details as { id: number }).id;

  result = await tool.execute("e2e", { action: "check", watchlist_name: "MAG7" });
  assert(toolText(result).includes("AAPL"), "check missing AAPL");
  assert(toolText(result).includes("MAG7"), "check missing watchlist name");

  result = await tool.execute("e2e", {
    action: "remove",
    item_id: itemId,
    watchlist_name: "MAG7",
  });
  assert(toolText(result).includes("Removed"), "remove failed");

  result = await tool.execute("e2e", { action: "check", watchlist_name: "MAG7" });
  assert(toolText(result).toLowerCase().includes("empty"), "empty check failed");
});

test("correlation: analyze_correlation on AAPL vs MSFT vs GOOGL", async () => {
  const tool = getTool("analyze_correlation");
  const result = await tool.execute("e2e", { symbols: ["AAPL", "MSFT", "GOOGL"] });
  assert(result.details != null, "details is null");
  const matrix = result.details.matrix;
  assert(matrix.AAPL.AAPL === 1.0, "self-correlation should be 1.0");
  assert(matrix.AAPL.MSFT === matrix.MSFT.AAPL, "matrix should be symmetric");
  const correlation = matrix.AAPL.MSFT;
  assert(correlation >= -1 && correlation <= 1, `correlation ${correlation} out of range`);
});

test("correlation: computeCorrelation returns 1.0 for same asset", async () => {
  const bars = await getHistory("SPY", "6mo", "1d");
  const closes = bars.map((bar) => bar.close);
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  const correlation = computeCorrelation(returns, returns);
  assert(
    Math.abs(correlation - 1.0) < 0.0001,
    `self-correlation should be 1.0, got ${correlation}`,
  );
});

test("orchestrator: roles are named personas with debate", async () => {
  const { buildComprehensiveAnalysisDefinition } = await import(
    "../../src/analysts/orchestrator.js"
  );
  const texts = buildComprehensiveAnalysisDefinition("AAPL")
    .steps.slice(1)
    .map((step) => step.prompt);
  assert(texts.length === 10, `expected 10 followUps, got ${texts.length}`);
  for (const persona of [
    "[Valuation Analyst]",
    "[Momentum Analyst]",
    "[Options Analyst]",
    "[Contrarian Analyst]",
    "[Risk Manager]",
    "[Bull Researcher]",
    "[Bear Researcher]",
    "[Bull Rebuttal]",
    "[Synthesis]",
    "[Validation",
  ]) {
    assert(
      texts.some((text) => text.includes(persona)),
      `missing ${persona}`,
    );
  }
  for (let i = 0; i < 5; i++) {
    assert(texts[i].includes("SIGNAL:"), `analyst ${i} missing SIGNAL format`);
  }
  assert(texts[8].includes("RESOLVE THE DEBATE"), "synthesis missing debate resolution");
});

test("sentiment: get_sentiment_trend returns no-data message for empty store", async () => {
  const tool = getTool("get_sentiment_trend");
  const result = await tool.execute("e2e", { query: "ZZZNOTREAL" });
  assert(toolText(result).includes("No historical sentiment data"), "should say no data");
});

test("sentiment: get_sentiment_summary tool exists and has correct name", async () => {
  const tool = getTool("get_sentiment_summary");
  assert(tool.name === "get_sentiment_summary", "wrong name");
});

test("sentiment: get_web_sentiment tool exists and has correct name", async () => {
  const tool = getTool("get_web_sentiment");
  assert(tool.name === "get_web_sentiment", "wrong name");
});

test("sentiment-store: insert and search round-trip", async () => {
  const storeDir = mkdtempSync(join(tmpdir(), "oc-store-e2e-"));
  try {
    const store = new SentimentStore(join(storeDir, "sentinel.db"));
    try {
      store.insert([
        {
          id: "e2e-1",
          source: "twitter",
          sourceId: "tw-1",
          query: "AAPL",
          title: null,
          text: "bullish AAPL",
          author: "@test",
          url: "https://x.com/test",
          publishedAt: new Date().toISOString(),
          fetchedAt: new Date().toISOString(),
          engagement: { score: 10, replies: null, shares: null, views: null },
          sentiment: { score: 0.5, confidence: 0.7, method: "keyword", tickers: ["AAPL"] },
          metadata: {},
        },
      ]);
      const results = store.search("AAPL");
      assert(results.length === 1, `expected 1 search result, got ${results.length}`);
    } finally {
      store.close();
    }
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Optional: external tool / optional key / web search availability
// ---------------------------------------------------------------------------

test(
  "sentiment: get_reddit_sentiment returns score in [-1, 1]",
  async () => {
    const tool = getTool("get_reddit_sentiment");
    let result: Awaited<ReturnType<typeof tool.execute>>;
    try {
      result = await tool.execute("e2e", { subreddit: "stocks", limit: 10 });
    } catch (error) {
      const reason = errorMessage(error);
      if (/403|rate|reddit|ENOENT|not installed|session|login|unauthor/i.test(reason)) {
        skip(`Reddit unavailable: ${reason}`);
      }
      throw error;
    }
    const details = result.details;
    if (details == null || typeof details.sentimentScore !== "number") {
      const text = toolText(result);
      if (/unavailable|not installed|session|403|rate limit|expired|login|auth/i.test(text)) {
        skip(`Reddit unavailable: ${text}`);
      }
      throw new Error(`Reddit returned no usable details: ${text}`);
    }
    assert(details.sentimentScore >= -1, `score ${details.sentimentScore} < -1`);
    assert(details.sentimentScore <= 1, `score ${details.sentimentScore} > 1`);
  },
  { optional: true },
);

test(
  "fundamentals: get_financials returns non-zero balance sheet + cash flow",
  async () => {
    if (!config.alphaVantageApiKey) skip("ALPHA_VANTAGE_API_KEY not configured");
    const tool = getTool("get_financials");
    let result: Awaited<ReturnType<typeof tool.execute>>;
    try {
      result = await tool.execute("e2e", { symbol: "MSFT" });
    } catch (error) {
      const reason = errorMessage(error);
      if (/rate|Thank you|frequency|No data found|rate limited/i.test(reason)) {
        skip(`Alpha Vantage unavailable: ${reason}`);
      }
      throw error;
    }
    if (!result.details || result.details.length === 0) {
      skip("Alpha Vantage returned empty financials (likely rate limited)");
    }
    const statement = result.details[0];
    if (statement.totalAssets === 0 && statement.revenue > 0) {
      skip("Alpha Vantage balance sheet rate limited; income data only");
    }
    assert(statement.totalAssets > 0, `totalAssets=${statement.totalAssets}`);
    assert(statement.totalLiabilities > 0, `totalLiabilities=${statement.totalLiabilities}`);
    assert(statement.freeCashFlow !== 0, `freeCashFlow=${statement.freeCashFlow}`);
  },
  { optional: true },
);

test(
  "fundamentals: compute_dcf tool on real stock (MSFT)",
  async () => {
    if (!config.alphaVantageApiKey) skip("ALPHA_VANTAGE_API_KEY not configured");
    const tool = getTool("compute_dcf");
    let result: Awaited<ReturnType<typeof tool.execute>>;
    try {
      result = await tool.execute("e2e", { symbol: "MSFT" });
    } catch (error) {
      const reason = errorMessage(error);
      if (/No data found|rate|frequency|Thank you/i.test(reason)) {
        skip(`Alpha Vantage unavailable: ${reason}`);
      }
      throw error;
    }
    assert(toolText(result).length > 10, "response too short");
  },
  { optional: true },
);

test(
  "fundamentals: compare_companies tool on AAPL vs MSFT",
  async () => {
    if (!config.alphaVantageApiKey) skip("ALPHA_VANTAGE_API_KEY not configured");
    const tool = getTool("compare_companies");
    let result: Awaited<ReturnType<typeof tool.execute>>;
    try {
      result = await tool.execute("e2e", { symbols: ["AAPL", "MSFT"] });
    } catch (error) {
      const reason = errorMessage(error);
      if (/No data found|rate|frequency|Thank you/i.test(reason)) {
        skip(`Alpha Vantage unavailable: ${reason}`);
      }
      throw error;
    }
    if (result.details == null) {
      skip("Alpha Vantage returned no overview data (likely rate limited)");
    }
    assert(result.details.companies.length === 2, "expected 2 companies");
  },
  { optional: true },
);

test(
  "web-search: search_web returns results for a financial query",
  async () => {
    const tool = getTool("search_web");
    const result = await tool.execute("e2e", { query: "Federal Reserve rate decision" });
    const text = toolText(result);
    if (result.details === null || /unavailable/i.test(text)) {
      skip(`web search unavailable: ${text}`);
    }
    const details = result.details;
    assert(
      details.provider === "ddg" || details.provider === "brave" || details.provider === "exa",
      `unexpected provider: ${details.provider}`,
    );
    if (details.resultCount === 0) skip("web search returned zero results");
    assert(details.results[0].title.length > 0, "first result has empty title");
    assert(details.results[0].url.startsWith("http"), "first result URL invalid");
    assert(details.results[0].snippet.length > 0, "first result has empty snippet");
    assert(details.results[0].source.length > 0, "first result has empty source");
  },
  { optional: true },
);

test(
  "web-search: search_web defaults to news category and day freshness",
  async () => {
    const tool = getTool("search_web");
    const result = await tool.execute("e2e", { query: "AAPL" });
    const text = toolText(result);
    if (result.details === null || /unavailable/i.test(text)) {
      skip(`web search unavailable: ${text}`);
    }
    assert(text.includes("news"), "output should mention news category");
    assert(text.includes("day"), "output should mention day freshness");
  },
  { optional: true },
);

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log(`\n=== OpenCandle tool canary (${cases.length} cases) ===`);
console.log(
  `Tools: ${tools.length} | AV key: ${config.alphaVantageApiKey ? "yes" : "no"} | strict: ${strict}\n`,
);

function printResult(result: CanaryCaseResult): void {
  const mark = result.outcome === "passed" ? "✓" : result.outcome === "skipped" ? "⊘" : "✗";
  const optional = result.optional ? " [optional]" : "";
  const reason = result.reason ? `: ${result.reason}` : "";
  console.log(`  ${mark} ${result.name}${optional} (${result.durationMs}ms)${reason}`);
}

let exitCode = 1;
try {
  const results = await runCases(cases, { onResult: printResult });
  console.log(`\n${results.formatSummary()}\n`);
  exitCode = results.exitCode({ requireAll: strict });
} finally {
  cleanup();
}
process.exit(exitCode);
