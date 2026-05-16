// Playwright-based screenshot harness for the GUI.
// Serves the built bundle on a throwaway port, mocks the WebSocket so the app
// boots with a deterministic catalog/dashboard, and captures a series of named
// states under tests/screenshots/out/<phase>/.
//
// Run:
//   npx tsx tests/screenshots/capture.ts <phase> [--viewport=desktop|mobile|both]
//
// The phase becomes the output subdirectory (e.g. "baseline", "post-sheet").
import { createReadStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright-core";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const webDist = resolve(repoRoot, "gui/web/dist");
const outRoot = resolve(__dirname, "out");

const VIEWPORTS = {
  desktop: { width: 1440, height: 960 },
  mobile: { width: 390, height: 844 },
} as const;

type ViewportKey = keyof typeof VIEWPORTS;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

const SAMPLE_CATALOG = {
  tools: [
    { name: "search_ticker", label: "Search Ticker", description: "Find a ticker symbol from a name or alias.", domain: "market", enabled: true, defaults: {}, parameters: { properties: { query: { type: "string", description: "Company or ticker name" } } } },
    { name: "get_stock_quote", label: "Stock Quote", description: "Real-time stock price, volume, market cap, and 52-week range.", domain: "market", enabled: true, defaults: {}, parameters: { properties: { symbol: { type: "string", description: "Stock ticker symbol" } } } },
    { name: "get_stock_history", label: "Stock History", description: "Historical OHLCV bars for a ticker.", domain: "market", enabled: true, defaults: {}, parameters: { properties: { symbol: { type: "string" }, range: { type: "string" }, interval: { type: "string" } } } },
    { name: "get_company_overview", label: "Company Overview", description: "P/E ratio, EPS, market cap, sector, dividend yield, profit margin, beta, and description.", domain: "fundamentals", enabled: true, defaults: {}, parameters: { properties: { symbol: { type: "string" } } } },
    { name: "calculate_dcf", label: "DCF Valuation", description: "Discounted cash flow valuation with adjustable growth, discount, and terminal rates.", domain: "fundamentals", enabled: true, defaults: {}, parameters: { properties: { symbol: { type: "string" }, growth_rate: { type: "number" }, discount_rate: { type: "number" }, terminal_growth: { type: "number" }, projection_years: { type: "number" } } } },
    { name: "compare_companies", label: "Comparable Company Analysis", description: "Compare 2–6 companies side-by-side on key valuation and financial metrics.", domain: "fundamentals", enabled: true, defaults: {}, parameters: { properties: { symbols: { type: "array" } } } },
    { name: "get_option_chain", label: "Options Chain", description: "Full options chain with strikes, expirations, IV, and Greeks.", domain: "options", enabled: true, defaults: {}, parameters: { properties: { symbol: { type: "string" }, expiration: { type: "string" }, type: { type: "string" } } } },
    { name: "analyze_correlation", label: "Correlation Matrix", description: "Pairwise correlation across symbols over a chosen window.", domain: "portfolio", enabled: true, defaults: {}, parameters: { properties: { symbols: { type: "array" }, period: { type: "string" } } } },
    { name: "analyze_risk", label: "Risk Analysis", description: "Annualized return, volatility, Sharpe ratio, max drawdown, and 95% VaR.", domain: "portfolio", enabled: true, defaults: {}, parameters: { properties: { symbol: { type: "string" }, period: { type: "string" } } } },
    { name: "get_economic_data", label: "FRED Economic Data", description: "Macro indicators from the Federal Reserve Economic Data API.", domain: "macro", enabled: true, defaults: {}, parameters: { properties: { series_id: { type: "string" }, limit: { type: "number" } } } },
    { name: "get_fear_greed", label: "Fear & Greed Index", description: "Crypto Fear & Greed Index from 0 (Extreme Fear) to 100 (Extreme Greed).", domain: "macro", enabled: true, defaults: {}, parameters: { properties: {} } },
    { name: "get_sentiment_summary", label: "Sentiment Summary", description: "Cross-source sentiment combining Twitter, Reddit, and web/news.", domain: "sentiment", enabled: true, defaults: {}, parameters: { properties: { query: { type: "string" }, hours: { type: "number" } } } },
  ],
  workflows: [
    { id: "comprehensive_analysis", name: "Comprehensive Analysis", description: "Multi-analyst stock breakdown across fundamentals, technicals, sentiment, and macro.", prompt: "/analyze {symbol}", slots: [{ name: "symbol", label: "Symbol", type: "text" }] },
    { id: "portfolio_builder", name: "Portfolio Builder", description: "Build a diversified portfolio from goals and constraints.", prompt: "Build me a portfolio for {objective}", slots: [{ name: "objective", label: "Objective", type: "text" }] },
    { id: "options_screener", name: "Options Screener", description: "Screen option chains for a target symbol.", prompt: "Screen options for {symbol}", slots: [{ name: "symbol", label: "Symbol", type: "text" }] },
    { id: "compare_assets", name: "Compare Assets", description: "Compare two or more assets side by side.", prompt: "Compare {symbols}", slots: [{ name: "symbols", label: "Symbols", type: "text" }] },
  ],
  providers: [
    { id: "alpha_vantage", displayName: "Alpha Vantage", source: "absent", status: "Not configured", unlocks: ["company fundamentals", "income/balance/cashflow statements", "DCF valuation", "earnings history"], fallbackDescription: null, signupUrl: "https://www.alphavantage.co/support/#api-key", envVar: "ALPHA_VANTAGE_API_KEY", instructionsHint: "Free, about 30 seconds, signup opens in your browser" },
    { id: "fred", displayName: "FRED", source: "absent", status: "Not configured", unlocks: ["interest rates", "inflation data", "yield curve", "economic indicators"], fallbackDescription: null, signupUrl: "https://fredaccount.stlouisfed.org/apikeys", envVar: "FRED_API_KEY", instructionsHint: "Free, about 30 seconds, requires a St. Louis Fed account" },
    { id: "finnhub", displayName: "Finnhub", source: "file", status: "Configured", unlocks: ["ticker-tagged company news", "sentiment enrichment with a dedicated news source"], fallbackDescription: "Other sentiment sources continue to work without Finnhub", signupUrl: "https://finnhub.io/register", envVar: "FINNHUB_API_KEY", instructionsHint: "Free, about 30 seconds, signup opens in your browser" },
    { id: "brave", displayName: "Brave Search", source: "absent", status: "Not configured", unlocks: ["tier-2 web search with freshness control", "independent search index outside DuckDuckGo"], fallbackDescription: "Web search continues via DuckDuckGo (free, lower-quality freshness)", signupUrl: "https://brave.com/search/api/", envVar: "BRAVE_API_KEY", instructionsHint: "Free tier available" },
    { id: "exa", displayName: "Exa", source: "env", status: "From env", unlocks: ["tier-1 semantic web search", "full article text and highlights"], fallbackDescription: "Falls back to keyless Exa MCP endpoint", signupUrl: "https://dashboard.exa.ai/", envVar: "EXA_API_KEY", instructionsHint: "Paid with free tier" },
  ],
};

const SAMPLE_DASHBOARD = {
  watchlist: [
    { symbol: "NVDA", quote: { price: 132.75, changePercent: 1.42 } },
    { symbol: "AAPL", quote: { price: 218.04, changePercent: -0.31 } },
    { symbol: "MSFT", quote: { price: 422.18, changePercent: 0.87 } },
  ],
  activeAnalyses: [],
  recentResearch: [],
  dataQuality: { softGaps: [], hardSkips: [] },
};

// Realistic in-flight session — workflow running, prior research, several gaps.
// Mirrors what the projector would emit after a few minutes of usage so the
// context drawer can be audited in a non-empty state.
const NOW = Date.now();
const minutesAgo = (n: number): string => new Date(NOW - n * 60_000).toISOString();
const RICH_DASHBOARD = {
  watchlist: [
    { symbol: "NVDA", quote: { price: 215.22, changePercent: 1.77, dayHigh: 218.40, dayLow: 211.80, marketCap: 5.32e12 }, lastSeen: minutesAgo(2) },
    { symbol: "AAPL", quote: { price: 218.04, changePercent: -0.31, dayHigh: 219.30, dayLow: 216.10, marketCap: 3.31e12 }, lastSeen: minutesAgo(8) },
    { symbol: "TSLA", quote: { price: 318.74, changePercent: -2.14, dayHigh: 326.80, dayLow: 316.20, marketCap: 1.02e12 }, lastSeen: minutesAgo(14) },
    { symbol: "META", quote: { price: 612.51, changePercent: 0.42, dayHigh: 614.20, dayLow: 608.10, marketCap: 1.55e12 }, lastSeen: minutesAgo(22) },
    { symbol: "BTC-USD", quote: { price: 96420.18, changePercent: 3.12, dayHigh: 97200, dayLow: 93800, marketCap: 1.91e12 }, lastSeen: minutesAgo(31) },
  ],
  activeAnalyses: [
    { workflowId: "wf-1", workflow: "comprehensive_analysis", symbol: "NVDA", analystsTotal: 5, analystsDone: 3, startedAt: minutesAgo(4) },
  ],
  recentResearch: [
    { sessionId: "s1", workflow: "options_screener", symbol: "AAPL", completedAt: minutesAgo(18) },
    { sessionId: "s1", workflow: "compare_assets", symbol: "NVDA, AMD", completedAt: minutesAgo(46) },
    { sessionId: "s1", workflow: "comprehensive_analysis", symbol: "TSLA", completedAt: minutesAgo(95) },
  ],
  dataQuality: {
    // Multiple repeats to exercise dedup
    softGaps: [
      { provider: "brave", lastSeen: minutesAgo(7) },
      { provider: "exa", lastSeen: minutesAgo(12) },
      { provider: "brave", lastSeen: minutesAgo(20) },
      { provider: "finnhub", lastSeen: minutesAgo(35) },
    ],
    hardSkips: [
      { provider: "fred", lastSeen: minutesAgo(1) },
      { provider: "fred", lastSeen: minutesAgo(9) },
      { provider: "fred", lastSeen: minutesAgo(17) },
      { provider: "alpha_vantage", lastSeen: minutesAgo(25) },
      { provider: "alpha_vantage", lastSeen: minutesAgo(50) },
    ],
  },
};

// Sample tool-result entries for rendering the chat thread. Each entry mirrors
// the shape Pi's session emits: a toolResult message with `content` (text) and
// `details` (typed payload) plus a stable id and timestamp.
function toolResultEntry(id: string, toolName: string, text: string, details: unknown, args: unknown = {}) {
  return {
    type: "message",
    id,
    timestamp: new Date().toISOString(),
    message: {
      role: "toolResult",
      toolName,
      content: [{ type: "text", text }],
      details: { ...(details as Record<string, unknown>), args },
    },
  };
}

const SENTIMENT_SUMMARY_TEXT = `[OPENCANDLE_SOFT_DEGRADED provider=finnhub fallback=other-sentiment-sources remediation="run /connect news to enable Finnhub company news"]

**Sentiment summary for "NVDA"** (last 24h):

| Source | Score | Count | Signal |
|--------|-------|-------|--------|
| Reddit | +0.90 | 5 | Bullish |
| Web/News | +0.20 | 5 | Leaning Bullish |

**Aggregate:** +0.55 (Bullish)

⚠ DIVERGENCE: Retail sentiment (+0.90) vs news sentiment (+0.20) — gap of 0.70.

⚠ Twitter: No Twitter session found.`;

// Synthetic but realistic indicator series for a chart with shape.
const SAMPLE_PRICES = (() => {
  const base = 200;
  const out: number[] = [];
  for (let i = 0; i < 200; i++) {
    const drift = (Math.sin(i / 18) + Math.sin(i / 7) * 0.4) * 12 + i * 0.08;
    out.push(base + drift);
  }
  return out;
})();
const SAMPLE_SMA = (window: number) => SAMPLE_PRICES.map((_, i) => {
  if (i < window - 1) return null as unknown as number;
  let sum = 0;
  for (let j = i - window + 1; j <= i; j++) sum += SAMPLE_PRICES[j];
  return sum / window;
}).filter((v) => Number.isFinite(v)) as number[];
const SAMPLE_RSI = SAMPLE_PRICES.map((_, i) => 50 + 22 * Math.sin(i / 11) + 7 * Math.sin(i / 3));
const SAMPLE_MACD = SAMPLE_PRICES.map((_, i) => {
  const macd = 2.4 * Math.sin(i / 14);
  const signal = 2.0 * Math.sin((i - 3) / 14);
  return { macd, signal, histogram: macd - signal };
});
const SAMPLE_BB = SAMPLE_PRICES.slice(19).map((_, i) => {
  const slice = SAMPLE_PRICES.slice(i, i + 20);
  const mean = slice.reduce((a, b) => a + b, 0) / 20;
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / 20;
  const sd = Math.sqrt(variance);
  return { upper: mean + 2 * sd, middle: mean, lower: mean - 2 * sd };
});

// Bars fixture for stock-history card. 105 15-minute bars with a realistic
// shape (slow drift up, a step around bar 35, mild noise).
const SAMPLE_HISTORY_BARS = (() => {
  const bars: Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }> = [];
  const start = Date.parse("2025-05-04T13:30:00Z");
  let price = 199.5;
  for (let i = 0; i < 105; i++) {
    const drift = i < 35 ? -0.02 : i < 60 ? 0.18 : 0.04;
    const noise = (Math.sin(i * 0.7) + Math.cos(i * 1.3)) * 0.4;
    const close = price + drift + noise;
    const high = close + Math.abs(noise) * 0.6 + 0.3;
    const low = close - Math.abs(noise) * 0.6 - 0.3;
    bars.push({
      date: new Date(start + i * 15 * 60_000).toISOString(),
      open: price,
      high,
      low,
      close,
      volume: 6_000_000 + Math.round(Math.abs(noise) * 2_000_000),
    });
    price = close;
  }
  return bars;
})();

function userEntry(id: string, text: string) {
  return {
    type: "message",
    id,
    timestamp: new Date().toISOString(),
    message: { role: "user", content: [{ type: "text", text }] },
  };
}

function assistantToolCallEntry(id: string, toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>) {
  return {
    type: "message",
    id,
    timestamp: new Date().toISOString(),
    message: {
      role: "assistant",
      content: toolCalls.map((tc) => ({ type: "toolCall", id: tc.id, name: tc.name, arguments: tc.arguments })),
    },
  };
}

function assistantTextEntry(id: string, text: string) {
  return {
    type: "message",
    id,
    timestamp: new Date().toISOString(),
    message: { role: "assistant", content: [{ type: "text", text }] },
  };
}

const WEB_SEARCH_RESULTS = [
  { title: "Apple unveils next-generation M-series chips at WWDC", url: "https://www.theverge.com/2025/06/12/apple-m4-chip-wwdc", snippet: "Apple announced its next-generation M-series silicon at WWDC 2025, with notable gains in neural engine throughput and 35% better single-threaded performance.", source: "The Verge", published: "2025-06-12T17:30:00Z", category: "tech" },
  { title: "Apple Q3 earnings beat estimates as services revenue surges", url: "https://www.bloomberg.com/news/articles/2025-08-01/apple-earnings", snippet: "Apple reported third-quarter earnings that exceeded Wall Street estimates, driven by strong services growth.", source: "Bloomberg", published: "2025-08-01T20:14:00Z", category: "earnings" },
  { title: "Why Warren Buffett trimmed Berkshire's Apple position again", url: "https://www.cnbc.com/2025/05/04/berkshire-apple-stake", snippet: "Berkshire Hathaway sold roughly $20 billion in Apple shares in Q1, continuing a divestment trend that began in 2024.", source: "CNBC", published: "2025-05-04T13:00:00Z", category: "investing" },
  { title: "iPhone shipments rebound in China for first time in a year", url: "https://www.reuters.com/technology/iphone-china-2025-07", snippet: "Apple's iPhone shipments in China rose 3% YoY, the first quarterly increase since early 2024.", source: "Reuters", published: "2025-07-15T09:21:00Z", category: "markets" },
  { title: "Apple's services business hits a $100B annual run rate", url: "https://www.wsj.com/articles/apple-services-revenue", snippet: "Services revenue including App Store, iCloud and Apple TV+ crossed $100B in trailing-twelve-months for the first time.", source: "WSJ", published: "2025-08-02T11:00:00Z", category: "business" },
  { title: "Apple Vision Pro 2 leaked: lighter, cheaper, M5 powered", url: "https://9to5mac.com/2025/09/01/vision-pro-2-leak", snippet: "Apple's next mixed-reality headset will ship with the rumored M5 chip and target a $2,499 price.", source: "9to5Mac", published: "2025-09-01T08:00:00Z", category: "tech" },
];

const TOOL_PAIRS = {
  sentiment: [
    userEntry("u-sentiment", "Sentiment summary on NVDA last 24h"),
    toolResultEntry("tr-sentiment", "get_sentiment_summary", SENTIMENT_SUMMARY_TEXT, {
      score: 0.55,
      sources: { reddit: { score: 0.90, count: 5 }, web: { score: 0.20, count: 5 } },
    }, { query: "NVDA", hours: 24 }),
  ],
  history: [
    userEntry("u-history", "Stock history NVDA 4d 15m"),
    {
      type: "message",
      id: "tr-history",
      timestamp: new Date().toISOString(),
      message: {
        role: "toolResult",
        toolName: "get_stock_history",
        content: [{ type: "text", text: `**${SAMPLE_HISTORY_BARS[SAMPLE_HISTORY_BARS.length - 1].close.toFixed(2)}** over ${SAMPLE_HISTORY_BARS.length} bars.` }],
        // The HistoryCard accepts an array directly OR a `{bars}` wrapper.
        // We pass the bars array as `details` directly since spreading would
        // turn it into an indexed object.
        details: SAMPLE_HISTORY_BARS,
      },
    },
  ],
  technical: [
    userEntry("u-tech", "Technical indicators for NVDA"),
    toolResultEntry("tr-tech", "get_technical_indicators",
      "**NVDA Technical Analysis** (2025-01-01 to 2025-12-31)\nPrice: $215.22\n\nSMA(20): $210.40 | SMA(50): $204.12\nRSI(14): 62.4 (Neutral)\nMACD: 0.92 | Signal: 0.58 | Histogram: 0.34\nBollinger Bands: Upper $222.10 | Mid $210.40 | Lower $198.70\n\nSignals: Price above SMA(20) — short-term bullish | Golden cross pattern (SMA20 > SMA50) | MACD bullish (histogram positive)",
      {
        symbol: "NVDA",
        range: "1y",
        prices: SAMPLE_PRICES,
        sma20: SAMPLE_SMA(20),
        sma50: SAMPLE_SMA(50),
        rsi: SAMPLE_RSI,
        macd: SAMPLE_MACD,
        bb: SAMPLE_BB,
        obv: [],
        vwap: [],
      },
      { symbol: "NVDA", range: "1y" },
    ),
  ],
  websearch: [
    userEntry("u-web", "Latest Apple news this week"),
    assistantToolCallEntry("a-web-call", [{ id: "tc-web-1", name: "search_web", arguments: { query: "Apple AAPL latest news" } }]),
    toolResultEntry("tr-web", "search_web", `**Web search results for "Apple AAPL latest news"** — 6 results`, {
      query: "Apple AAPL latest news",
      provider: "exa",
      results: WEB_SEARCH_RESULTS,
    }, { query: "Apple AAPL latest news" }),
    assistantTextEntry("a-final", "Here's a roundup of Apple news this week: the M-series chip refresh at WWDC, Q3 services revenue blow-out, Buffett trimming Berkshire's stake, an iPhone rebound in China, and the leaked Vision Pro 2 spec sheet."),
  ],
  multistep: [
    userEntry("u-multi", "Pull AAPL quote + sentiment + recent filings"),
    assistantToolCallEntry("a-multi-1", [{ id: "tc-quote", name: "get_stock_quote", arguments: { symbol: "AAPL" } }]),
    toolResultEntry("tr-quote", "get_stock_quote", "AAPL quote retrieved", { symbol: "AAPL", price: 218.04, change: -0.68, changePercent: -0.31, previousClose: 218.72, open: 218.90, high: 219.30, low: 216.10, volume: 41_800_000, marketCap: 3.31e12, pe: 33.6, week52High: 235.10, week52Low: 164.20, timestamp: new Date().toISOString() }, { symbol: "AAPL" }),
    assistantToolCallEntry("a-multi-2", [{ id: "tc-sent", name: "get_sentiment_summary", arguments: { query: "AAPL", hours: 24 } }]),
    toolResultEntry("tr-sent", "get_sentiment_summary", "AAPL sentiment over 24h", { score: 0.18, sources: { reddit: { score: 0.32, count: 14 }, web: { score: 0.04, count: 18 } } }, { query: "AAPL" }),
    assistantToolCallEntry("a-multi-3", [{ id: "tc-sec", name: "get_sec_filings", arguments: { symbol: "AAPL" } }]),
    toolResultEntry("tr-sec", "get_sec_filings", "AAPL filings", {
      symbol: "AAPL",
      filings: [
        { formType: "10-Q", filedDate: "2025-08-01T20:00:00Z", periodOfReport: "2025-06-29", accessionNumber: "0000320193-25-000077", url: "https://www.sec.gov/Archives/edgar/data/320193/000032019325000077/0000320193-25-000077-index.htm" },
        { formType: "8-K", filedDate: "2025-07-24T18:00:00Z", periodOfReport: "2025-07-24", accessionNumber: "0000320193-25-000075", url: "https://www.sec.gov/Archives/edgar/data/320193/000032019325000075/0000320193-25-000075-index.htm" },
        { formType: "DEF 14A", filedDate: "2025-01-10T16:30:00Z", periodOfReport: "2025-03-01", accessionNumber: "0000320193-25-000010", url: "https://www.sec.gov/Archives/edgar/data/320193/000032019325000010/0000320193-25-000010-index.htm" },
      ],
    }, { symbol: "AAPL" }),
    assistantTextEntry("a-multi-final", "**AAPL snapshot**: trading around $218 (-0.31%), neutral-positive sentiment (+0.18 aggregate), and a clean recent filing trail with last 10-Q on Aug 1. Nothing alarming in the data; Reddit chatter is slightly more bullish than press coverage."),
  ],
};

async function startStaticServer(): Promise<{ server: Server; baseUrl: string }> {
  if (!existsSync(webDist)) {
    throw new Error(`gui/web/dist missing — run 'npm run gui:web:build' first.`);
  }
  return await new Promise((resolveStart, rejectStart) => {
    const server = createServer((req, res) => {
      const requested = !req.url || req.url === "/" ? "/index.html" : req.url.split("?")[0];
      const requestedPath = resolve(join(webDist, requested));
      const fallback = resolve(join(webDist, "index.html"));
      const target = requestedPath.startsWith(webDist) && existsSync(requestedPath) ? requestedPath : fallback;
      res.setHeader("content-type", MIME[extname(target)] ?? "application/octet-stream");
      createReadStream(target).pipe(res);
    });
    server.on("error", rejectStart);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        rejectStart(new Error("Server bound to unknown address"));
        return;
      }
      resolveStart({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

// Read the mock-ws shim once. Re-reading from disk on every page in addInitScript
// adds noticeable latency for full screenshot runs.
const MOCK_WS_SOURCE = readFileSync(resolve(__dirname, "mock-ws.js"), "utf8");

async function installMocks(page: Page, overrides: Record<string, unknown> = {}): Promise<void> {
  const payload = {
    catalog: overrides.catalog ?? SAMPLE_CATALOG,
    dashboard: overrides.dashboard ?? SAMPLE_DASHBOARD,
    sessions: overrides.sessions ?? [{ id: "s1", path: "/tmp/s1", title: "Recent NVDA analysis", updated: Date.now() }],
    entries: overrides.entries ?? [],
    modelSetup: overrides.modelSetup ?? { requirement: "ready", providers: [], availableModels: [] },
  };
  await page.addInitScript((mockPayload) => {
    (window as unknown as { __MOCK_PAYLOAD: unknown }).__MOCK_PAYLOAD = mockPayload;
  }, payload);
  await page.addInitScript({ content: MOCK_WS_SOURCE });
}

interface Capture {
  name: string;
  setup: (page: Page) => Promise<void>;
  // Override the dashboard / catalog / etc. for this capture only.
  overrides?: Record<string, unknown>;
  // When true, capture the full scrollable page (useful for tall tool cards).
  fullPage?: boolean;
}

const CAPTURES: Capture[] = [
  {
    name: "01-empty-thread",
    setup: async () => { /* default */ },
  },
  {
    name: "02-sidebar-catalog-button",
    setup: async (page) => {
      // Hover the Settings/Catalog button so its current label is visible.
      await page.locator("button").filter({ hasText: /Settings|Catalog/ }).first().hover().catch(() => {});
    },
  },
  {
    name: "03-catalog-workflows-list",
    setup: async (page) => {
      await openCatalog(page);
    },
  },
  {
    name: "04-catalog-tools-list",
    setup: async (page) => {
      await openCatalog(page);
      await page.getByRole("button", { name: /^Tools/ }).click().catch(() => {});
      await page.waitForTimeout(120);
    },
  },
  {
    name: "05-catalog-providers-list",
    setup: async (page) => {
      await openCatalog(page);
      await page.getByRole("button", { name: /^Providers/ }).click().catch(() => {});
      await page.waitForTimeout(120);
    },
  },
  {
    name: "06-workflow-builder-portfolio",
    setup: async (page) => {
      await openCatalog(page);
      await page.getByText("Portfolio Builder").first().click().catch(() => {});
      await page.waitForTimeout(180);
    },
  },
  {
    name: "07-workflow-builder-options",
    setup: async (page) => {
      await openCatalog(page);
      await page.getByText("Options Screener").first().click().catch(() => {});
      await page.waitForTimeout(180);
    },
  },
  {
    name: "08-tool-builder-dcf",
    setup: async (page) => {
      await openCatalog(page);
      await page.getByRole("button", { name: /^Tools/ }).click().catch(() => {});
      await page.waitForTimeout(120);
      await page.getByText("DCF Valuation").first().click().catch(() => {});
      await page.waitForTimeout(180);
    },
  },
  {
    name: "09-tool-builder-options-chain",
    setup: async (page) => {
      await openCatalog(page);
      await page.getByRole("button", { name: /^Tools/ }).click().catch(() => {});
      await page.waitForTimeout(120);
      await page.getByText("Options Chain").first().click().catch(() => {});
      await page.waitForTimeout(180);
    },
  },
  {
    name: "10-provider-builder-alpha-vantage",
    setup: async (page) => {
      await openCatalog(page);
      await page.getByRole("button", { name: /^Providers/ }).click().catch(() => {});
      await page.waitForTimeout(120);
      await page.getByText("Alpha Vantage").first().click().catch(() => {});
      await page.waitForTimeout(180);
    },
  },
  {
    name: "11-context-drawer-empty",
    setup: async (page) => { await openContext(page); },
  },
  {
    name: "12-context-drawer-rich",
    overrides: { dashboard: RICH_DASHBOARD },
    setup: async (page) => { await openContext(page); },
  },
  {
    name: "13-context-drawer-gaps-only",
    overrides: { dashboard: { ...RICH_DASHBOARD, watchlist: [], activeAnalyses: [], recentResearch: [] } },
    setup: async (page) => { await openContext(page); },
  },
  {
    name: "14-tool-output-sentiment-summary",
    overrides: { entries: TOOL_PAIRS.sentiment },
    setup: async (page) => { await scrollChatToBottom(page); },
  },
  {
    name: "15-tool-output-technical-indicators",
    overrides: { entries: TOOL_PAIRS.technical },
    setup: async (page) => { await scrollChatToBottom(page); },
  },
  {
    name: "16-tool-output-stock-history",
    overrides: { entries: TOOL_PAIRS.history },
    setup: async (page) => { await scrollChatToBottom(page); },
  },
  {
    name: "17-tool-output-stock-history-hover",
    overrides: { entries: TOOL_PAIRS.history },
    setup: async (page) => {
      await scrollChatToBottom(page);
      const chart = page.locator("svg[aria-label='Price history chart']").first();
      const box = await chart.boundingBox({ timeout: 2000 }).catch(() => null);
      if (box) {
        await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.4);
        await page.waitForTimeout(120);
      }
    },
  },
  {
    name: "18-tool-drawer-stock-history",
    overrides: { entries: TOOL_PAIRS.history },
    setup: async (page) => { await openStepsDrawer(page); },
  },
  {
    name: "19-tool-drawer-sentiment-summary",
    overrides: { entries: TOOL_PAIRS.sentiment },
    setup: async (page) => { await openStepsDrawer(page); },
  },
  {
    name: "20-tool-drawer-technical-indicators",
    overrides: { entries: TOOL_PAIRS.technical },
    setup: async (page) => { await openStepsDrawer(page); },
  },
  {
    name: "21-tool-output-websearch",
    overrides: { entries: TOOL_PAIRS.websearch },
    setup: async (page) => { await scrollChatToBottom(page); },
  },
  {
    name: "22-tool-drawer-websearch",
    overrides: { entries: TOOL_PAIRS.websearch },
    setup: async (page) => { await openStepsDrawer(page); },
  },
  {
    name: "23-tool-output-multistep",
    overrides: { entries: TOOL_PAIRS.multistep },
    setup: async (page) => { await scrollChatToBottom(page); },
  },
  {
    name: "24-tool-drawer-multistep",
    overrides: { entries: TOOL_PAIRS.multistep },
    setup: async (page) => { await openStepsDrawer(page); },
  },
];

// Pin the chat scroll container to the bottom so tall tool cards are
// fully in view before screenshotting.
async function scrollChatToBottom(page: Page): Promise<void> {
  await page.evaluate(() => {
    const containers = document.querySelectorAll("section .overflow-y-auto");
    containers.forEach((el) => { (el as HTMLElement).scrollTop = (el as HTMLElement).scrollHeight; });
  });
  await page.waitForTimeout(180);
}

async function openStepsDrawer(page: Page): Promise<void> {
  await scrollChatToBottom(page);
  const stepsButton = page.locator("button[aria-expanded]:has-text('step')").first();
  await stepsButton.click({ timeout: 3000 }).catch(() => {});
  // Desktop slide-in is ~200ms; mobile vaul sheet animates in similarly.
  await page.waitForTimeout(280);
}

async function openContext(page: Page): Promise<void> {
  const sidebarBtn = page.locator("aside button:has-text('Context')").first();
  const mobileBtn = page.locator("button[aria-label='Open context']:visible").first();
  if (await sidebarBtn.isVisible().catch(() => false)) await sidebarBtn.click({ timeout: 2000 }).catch(() => {});
  else await mobileBtn.click({ timeout: 2000 }).catch(() => {});
  await page.waitForSelector("[role='dialog']", { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(280);
}

async function openCatalog(page: Page): Promise<void> {
  // Mobile header is `md:hidden` — its DOM nodes still exist on desktop, so
  // count() matches there too. Filter by visibility before clicking.
  const sidebarCatalog = page.locator("aside button:has-text('Catalog')").first();
  const mobileBtn = page.locator("button[aria-label='Open catalog']:visible").first();
  if (await sidebarCatalog.isVisible().catch(() => false)) {
    await sidebarCatalog.click({ timeout: 2000 }).catch(() => {});
  } else if (await mobileBtn.count()) {
    await mobileBtn.click({ timeout: 2000 }).catch(() => {});
  } else {
    await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  }
  await page.waitForSelector("[role='dialog']", { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(280);
}

async function captureViewport(browser: Browser, baseUrl: string, viewport: ViewportKey, phase: string): Promise<void> {
  const dir = resolve(outRoot, phase, viewport);
  mkdirSync(dir, { recursive: true });
  for (const capture of CAPTURES) {
    const start = Date.now();
    const context = await browser.newContext({ viewport: VIEWPORTS[viewport] });
    // Block external font CDN — without this Playwright's screenshot blocks on
    // document.fonts.ready for ~30s waiting for Google Fonts that never resolve.
    await context.route(/(fonts\.googleapis\.com|fonts\.gstatic\.com)/, (route) => route.abort());
    const page = await context.newPage();
    try {
      await installMocks(page, capture.overrides ?? {});
      await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(
        () => Boolean((window as unknown as { __mockReady?: boolean }).__mockReady),
        undefined,
        { timeout: 4000 },
      );
      await page.waitForTimeout(150);
      await capture.setup(page);
      await page.waitForTimeout(180);
      await page.screenshot({ path: resolve(dir, `${capture.name}.png`), fullPage: capture.fullPage === true, animations: "disabled", caret: "hide", timeout: 5000 });
      process.stdout.write(`  [${viewport}] ${capture.name}.png (${Date.now() - start}ms)\n`);
    } finally {
      await context.close();
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const phase = args[0] ?? "untitled";
  const viewportArg = (args.find((a) => a.startsWith("--viewport="))?.split("=")[1] ?? "both") as
    | ViewportKey
    | "both";

  const phaseDir = resolve(outRoot, phase);
  await rm(phaseDir, { recursive: true, force: true });

  const { server, baseUrl } = await startStaticServer();
  process.stdout.write(`Static server: ${baseUrl}\n`);

  const browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true });
  try {
    if (viewportArg === "desktop" || viewportArg === "both") {
      process.stdout.write(`Capturing desktop (${VIEWPORTS.desktop.width}×${VIEWPORTS.desktop.height})…\n`);
      await captureViewport(browser, baseUrl, "desktop", phase);
    }
    if (viewportArg === "mobile" || viewportArg === "both") {
      process.stdout.write(`Capturing mobile (${VIEWPORTS.mobile.width}×${VIEWPORTS.mobile.height})…\n`);
      await captureViewport(browser, baseUrl, "mobile", phase);
    }
  } finally {
    await browser.close();
    server.close();
  }
  process.stdout.write(`Wrote ${phase} screenshots to ${phaseDir}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
