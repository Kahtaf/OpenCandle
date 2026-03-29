/**
 * End-to-end test: runs every tool against 10 stocks and 10 crypto tickers.
 * Reports pass/fail for each combination.
 */
import { cache } from "../../src/infra/cache.js";
import { loadEnv } from "../../src/config.js";
import { getQuote, getHistory } from "../../src/providers/yahoo-finance.js";
import { getCryptoPrice, getCryptoHistory } from "../../src/providers/coingecko.js";
import { getOverview, getEarnings, getFinancials } from "../../src/providers/alpha-vantage.js";
import { getSeries } from "../../src/providers/fred.js";
import { getFearGreedIndex } from "../../src/providers/fear-greed.js";
import { getSubredditPosts } from "../../src/providers/reddit.js";
import { computeRiskMetrics, computeDailyReturns } from "../../src/tools/portfolio/risk-analysis.js";
import { computeSMA, computeRSI, computeMACD, computeBollingerBands } from "../../src/tools/technical/indicators.js";

loadEnv();

const STOCKS = [
  // US exchange
  "AAPL", "MSFT", "GOOGL", "AMZN", "TSLA",
  "NVDA", "META", "JPM", "V", "SPY",
  // Canadian exchange
  "RY.TO", "TD.TO", "SHOP.TO", "ENB.TO", "BNS.TO",
];

const CRYPTO = [
  "bitcoin", "ethereum", "solana", "dogecoin", "cardano",
  "ripple", "polkadot", "chainlink", "avalanche-2", "litecoin",
];

// Yahoo Finance tickers for crypto (for quote/history/technicals)
const CRYPTO_YAHOO = [
  "BTC-USD", "ETH-USD", "SOL-USD", "DOGE-USD", "ADA-USD",
  "XRP-USD", "DOT-USD", "LINK-USD", "AVAX-USD", "LTC-USD",
];

const avKey = process.env.ALPHA_VANTAGE_API_KEY;
const fredKey = process.env.FRED_API_KEY;

type Result = { tool: string; ticker: string; status: "PASS" | "FAIL"; error?: string };
const results: Result[] = [];

async function test(tool: string, ticker: string, fn: () => Promise<any>) {
  try {
    const data = await fn();
    if (data == null) throw new Error("null response");
    results.push({ tool, ticker, status: "PASS" });
    process.stdout.write(".");
  } catch (e: any) {
    results.push({ tool, ticker, status: "FAIL", error: e.message?.slice(0, 80) });
    process.stdout.write("X");
  }
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

console.log("=== Vantage E2E Test Suite ===\n");

// --- STOCKS: Quote + History ---
console.log(`\n[1/8] Stock Quotes (${STOCKS.length} tickers)...`);
for (const s of STOCKS) {
  await test("get_stock_quote", s, () => getQuote(s));
}

console.log(`\n[2/8] Stock History (${STOCKS.length} tickers)...`);
for (const s of STOCKS) {
  await test("get_stock_history", s, () => getHistory(s, "1mo", "1d"));
}

// --- CRYPTO: CoinGecko Price + History ---
console.log(`\n[3/8] Crypto Prices (${CRYPTO.length} tickers)...`);
for (const c of CRYPTO) {
  await test("get_crypto_price", c, () => getCryptoPrice(c));
  await sleep(6500); // CoinGecko rate limit: 10 req/min
}

console.log(`\n[4/8] Crypto History (${CRYPTO.length} tickers)...`);
for (const c of CRYPTO) {
  await test("get_crypto_history", c, () => getCryptoHistory(c, 30));
  await sleep(6500);
}

// --- TECHNICALS: Compute from Yahoo data (stocks + crypto) ---
console.log(`\n[5/8] Technical Indicators (stocks + crypto via Yahoo)...`);
const techTickers = [...STOCKS.slice(0, 5), ...CRYPTO_YAHOO.slice(0, 5)];
for (const t of techTickers) {
  await test("technicals", t, async () => {
    const bars = await getHistory(t, "6mo", "1d");
    const closes = bars.map((b) => b.close);
    if (closes.length < 35) throw new Error("insufficient data");
    const sma = computeSMA(closes, 20);
    const rsi = computeRSI(closes, 14);
    const macd = computeMACD(closes);
    const bb = computeBollingerBands(closes, 20, 2);
    if (!sma.length || !rsi.length || !macd.length || !bb.length)
      throw new Error("empty indicators");
    return { sma: sma.length, rsi: rsi.length, macd: macd.length, bb: bb.length };
  });
}

// --- RISK: Compute from Yahoo data ---
console.log(`\n[6/8] Risk Analysis (stocks + crypto)...`);
const riskTickers = [...STOCKS.slice(0, 5), ...CRYPTO_YAHOO.slice(0, 5)];
for (const t of riskTickers) {
  await test("risk_analysis", t, async () => {
    const bars = await getHistory(t, "1y", "1d");
    const closes = bars.map((b) => b.close);
    if (closes.length < 30) throw new Error("insufficient data");
    const metrics = computeRiskMetrics(t, closes);
    if (isNaN(metrics.sharpeRatio)) throw new Error("NaN sharpe");
    return metrics;
  });
}

// --- FUNDAMENTALS: Alpha Vantage (US stocks only, rate limited) ---
if (avKey) {
  console.log(`\n[7/8] Fundamentals (Alpha Vantage, 5 US stocks)...`);
  const avStocks = STOCKS.slice(0, 5); // Only US stocks, and limit to 5 to stay in rate limits
  for (const s of avStocks) {
    await test("company_overview", s, () => getOverview(s, avKey));
    await sleep(13000); // 5 req/min free tier
  }
  // Only test earnings/financials for 2 stocks to conserve rate limit
  for (const s of avStocks.slice(0, 2)) {
    await test("earnings", s, () => getEarnings(s, avKey));
    await sleep(13000);
    await test("financials", s, () => getFinancials(s, avKey));
    await sleep(13000);
  }
} else {
  console.log("\n[7/8] Fundamentals — SKIPPED (no ALPHA_VANTAGE_API_KEY)");
}

// --- MACRO + SENTIMENT ---
console.log(`\n[8/8] Macro + Sentiment...`);
await test("fear_greed", "index", () => getFearGreedIndex());
if (fredKey) {
  await test("fred", "FEDFUNDS", () => getSeries("FEDFUNDS", fredKey, 10));
  await test("fred", "DGS10", () => getSeries("DGS10", fredKey, 10));
  await test("fred", "CPIAUCSL", () => getSeries("CPIAUCSL", fredKey, 10));
} else {
  console.log(" FRED — SKIPPED (no FRED_API_KEY)");
}
await test("reddit", "wallstreetbets", () => getSubredditPosts("wallstreetbets", 10));
await test("reddit", "stocks", () => getSubredditPosts("stocks", 10));
await test("reddit", "cryptocurrency", () => getSubredditPosts("cryptocurrency", 10));

// --- RESULTS ---
console.log("\n\n=== RESULTS ===\n");

const passed = results.filter((r) => r.status === "PASS");
const failed = results.filter((r) => r.status === "FAIL");

console.log(`Total: ${results.length} | PASS: ${passed.length} | FAIL: ${failed.length}\n`);

if (failed.length > 0) {
  console.log("FAILURES:");
  for (const f of failed) {
    console.log(`  ❌ ${f.tool} [${f.ticker}]: ${f.error}`);
  }
}

// Group by tool
const byTool = new Map<string, Result[]>();
for (const r of results) {
  if (!byTool.has(r.tool)) byTool.set(r.tool, []);
  byTool.get(r.tool)!.push(r);
}

console.log("\nBy Tool:");
for (const [tool, toolResults] of byTool) {
  const p = toolResults.filter((r) => r.status === "PASS").length;
  const f = toolResults.filter((r) => r.status === "FAIL").length;
  const tickers = toolResults.map((r) => (r.status === "PASS" ? "✅" : "❌") + r.ticker).join(" ");
  console.log(`  ${p}/${p + f} ${tool}: ${tickers}`);
}

process.exit(failed.length > 0 ? 1 : 0);
