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
    name: "11-context-drawer",
    setup: async (page) => {
      const sidebarBtn = page.locator("aside button:has-text('Context')").first();
      const mobileBtn = page.locator("button[aria-label='Open context']:visible").first();
      if (await sidebarBtn.isVisible().catch(() => false)) await sidebarBtn.click({ timeout: 2000 }).catch(() => {});
      else await mobileBtn.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(300);
    },
  },
];

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
      await installMocks(page);
      await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(
        () => Boolean((window as unknown as { __mockReady?: boolean }).__mockReady),
        undefined,
        { timeout: 4000 },
      );
      await page.waitForTimeout(150);
      await capture.setup(page);
      await page.waitForTimeout(180);
      await page.screenshot({ path: resolve(dir, `${capture.name}.png`), fullPage: false, animations: "disabled", caret: "hide", timeout: 5000 });
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
