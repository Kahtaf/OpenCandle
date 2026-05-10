// Per-tool input descriptors. Maps tool name → array of fields, where each
// field carries enough metadata for the builder to render the right primitive,
// surface a sensible default, and produce a clean prompt preview.
//
// Tools without an entry fall back to the generic schema-driven render in
// tool-builder.jsx.

const SYMBOL = (overrides = {}) => ({
  name: "symbol", kind: "symbol", label: "Symbol", required: true, default: "NVDA", placeholder: "AAPL", ...overrides,
});
const QUERY_TICKER_OR_TOPIC = (overrides = {}) => ({
  name: "query", kind: "text", label: "Ticker or topic", required: true, placeholder: "AAPL or AI infrastructure", ...overrides,
});

export const TOOL_SCHEMAS = {
  // -----------------------------------------------------------------------
  // Market
  // -----------------------------------------------------------------------
  search_ticker: [{
    name: "query", kind: "text", label: "Search query", required: true,
    placeholder: "apple, AAPL, ethereum…",
    helper: "Company name, ticker, or crypto. Returns the best matches.",
  }],
  get_stock_quote: [SYMBOL()],
  get_stock_history: [
    SYMBOL(),
    { name: "range", kind: "segmented", label: "Range", default: "6mo", options: "RANGE_OPTIONS" },
    { name: "interval", kind: "select", label: "Interval", default: "1d", options: [
      { value: "1d", label: "Daily" }, { value: "1wk", label: "Weekly" }, { value: "1mo", label: "Monthly" }, { value: "1h", label: "Hourly" }, { value: "5m", label: "5 min" },
    ] },
  ],
  get_crypto_price: [{
    name: "id", kind: "text", label: "Coin ID", required: true, default: "bitcoin",
    placeholder: "bitcoin, ethereum, solana",
    helper: "CoinGecko coin id (lowercase, hyphenated).",
  }],
  get_crypto_history: [
    { name: "id", kind: "text", label: "Coin ID", required: true, default: "bitcoin", placeholder: "bitcoin", helper: "CoinGecko coin id." },
    { name: "days", kind: "number-chips", label: "History window", default: 180, presets: "DAYS_PRESETS", suffix: "days", helper: "1, 7, 14, 30, 90, 180, 365, or 'max'." },
  ],

  // -----------------------------------------------------------------------
  // Fundamentals
  // -----------------------------------------------------------------------
  get_company_overview: [SYMBOL()],
  get_financials: [
    SYMBOL(),
    { name: "statement", kind: "select", label: "Statement", default: "income", options: [
      { value: "income", label: "Income statement" },
      { value: "balance", label: "Balance sheet" },
      { value: "cashflow", label: "Cash flow" },
    ] },
  ],
  get_earnings: [SYMBOL()],
  calculate_dcf: [
    SYMBOL(),
    { name: "growth_rate", kind: "percent", label: "FCF growth rate", helper: "Annual. Estimated from history if blank." },
    { name: "discount_rate", kind: "percent", label: "Discount rate (WACC)", default: 0.10 },
    { name: "terminal_growth", kind: "percent", label: "Terminal growth", default: 0.03 },
    { name: "projection_years", kind: "number-chips", label: "Projection years", default: 5, presets: [
      { value: 3, label: "3y" }, { value: 5, label: "5y" }, { value: 7, label: "7y" }, { value: 10, label: "10y" },
    ], suffix: "yrs" },
  ],
  compare_companies: [{
    name: "symbols", kind: "symbols", label: "Tickers", required: true, min: 2, max: 6, default: ["AAPL", "MSFT", "GOOGL"],
    helper: "Pick 2 to 6 tickers to compare side by side.",
  }],
  get_sec_filings: [
    SYMBOL(),
    { name: "form_types", kind: "multi-chips", label: "Filing types", default: ["10-K", "10-Q", "8-K"], options: [
      { value: "10-K", label: "10-K (annual)" },
      { value: "10-Q", label: "10-Q (quarterly)" },
      { value: "8-K", label: "8-K (material)" },
      { value: "S-1", label: "S-1" },
      { value: "DEF 14A", label: "Proxy (DEF 14A)" },
    ] },
    { name: "limit", kind: "number-chips", label: "Max results", default: 10, presets: [
      { value: 5, label: "5" }, { value: 10, label: "10" }, { value: 25, label: "25" }, { value: 50, label: "50" },
    ] },
  ],

  // -----------------------------------------------------------------------
  // Macro
  // -----------------------------------------------------------------------
  get_economic_data: [
    { name: "series_id", kind: "text", label: "FRED series", required: true, default: "CPIAUCSL",
      placeholder: "CPIAUCSL", helper: "Common: CPIAUCSL (CPI), DGS10 (10Y), UNRATE (unemployment), FEDFUNDS.",
      suggestions: [
        { value: "CPIAUCSL", label: "CPI" },
        { value: "DGS10", label: "10Y Treasury" },
        { value: "UNRATE", label: "Unemployment" },
        { value: "FEDFUNDS", label: "Fed Funds" },
        { value: "GDP", label: "GDP" },
      ] },
    { name: "limit", kind: "number-chips", label: "Observations", default: 30, presets: [
      { value: 12, label: "12" }, { value: 30, label: "30" }, { value: 60, label: "60" }, { value: 120, label: "120" },
    ] },
  ],
  get_fear_greed: [],

  // -----------------------------------------------------------------------
  // Technical
  // -----------------------------------------------------------------------
  get_technical_indicators: [
    SYMBOL(),
    { name: "range", kind: "segmented", label: "Range", default: "1y", options: [
      { value: "3mo", label: "3M" }, { value: "6mo", label: "6M" }, { value: "1y", label: "1Y" }, { value: "2y", label: "2Y" },
    ] },
  ],
  backtest_strategy: [
    SYMBOL(),
    { name: "strategy", kind: "select", label: "Strategy", required: true, default: "sma_crossover", options: [
      { value: "sma_crossover", label: "SMA crossover (20/50)" },
      { value: "rsi_mean_reversion", label: "RSI mean reversion (30/70)" },
    ] },
    { name: "period", kind: "segmented", label: "Lookback", default: "2y", options: [
      { value: "1y", label: "1Y" }, { value: "2y", label: "2Y" }, { value: "5y", label: "5Y" },
    ] },
  ],

  // -----------------------------------------------------------------------
  // Portfolio
  // -----------------------------------------------------------------------
  manage_portfolio: [
    { name: "action", kind: "segmented", label: "Action", required: true, default: "check", options: [
      { value: "add", label: "Add" }, { value: "remove", label: "Remove" }, { value: "check", label: "Check" }, { value: "list", label: "List" },
    ] },
    SYMBOL({ required: false, helper: "Required for add/remove." }),
    { name: "shares", kind: "number-chips", label: "Shares", presets: [
      { value: 10, label: "10" }, { value: 100, label: "100" }, { value: 500, label: "500" },
    ], helper: "Required when adding a position." },
    { name: "avg_cost", kind: "money", label: "Average cost basis", helper: "Per share, in your portfolio currency." },
  ],
  watchlist: [
    { name: "action", kind: "segmented", label: "Action", required: true, default: "check", options: [
      { value: "add", label: "Add" }, { value: "remove", label: "Remove" }, { value: "check", label: "Check" },
    ] },
    SYMBOL({ required: false }),
    { name: "target_price", kind: "money", label: "Target (alert ↑)" },
    { name: "stop_price", kind: "money", label: "Stop (alert ↓)" },
  ],
  analyze_correlation: [
    { name: "symbols", kind: "symbols", label: "Tickers", required: true, min: 2, max: 12, default: ["SPY", "QQQ", "TLT"], helper: "2 or more tickers." },
    { name: "period", kind: "segmented", label: "Window", default: "1y", options: "PERIOD_OPTIONS" },
  ],
  analyze_risk: [
    SYMBOL(),
    { name: "period", kind: "segmented", label: "Window", default: "1y", options: "PERIOD_OPTIONS" },
  ],
  predict_returns: [{
    name: "symbols", kind: "symbols", label: "Tickers", required: true, min: 1, max: 8, default: ["NVDA", "AAPL"],
    helper: "Forecast 1-week and 1-month return ranges.",
  }],

  // -----------------------------------------------------------------------
  // Options
  // -----------------------------------------------------------------------
  get_option_chain: [
    SYMBOL(),
    { name: "expiration", kind: "date", label: "Expiration", helper: "Defaults to nearest expiration." },
    { name: "type", kind: "segmented", label: "Type", options: [
      { value: "", label: "Both" },
      { value: "call", label: "Calls" },
      { value: "put", label: "Puts" },
    ] },
  ],

  // -----------------------------------------------------------------------
  // Sentiment
  // -----------------------------------------------------------------------
  get_reddit_sentiment: [
    { name: "subreddit", kind: "text", label: "Subreddit", placeholder: "wallstreetbets, stocks, all", helper: "Leave blank to search defaults." },
    { name: "query", kind: "text", label: "Filter query", placeholder: "AAPL or 'rate cuts'" },
  ],
  get_twitter_sentiment: [
    QUERY_TICKER_OR_TOPIC(),
    { name: "limit", kind: "number-chips", label: "Tweets", default: 50, presets: [
      { value: 25, label: "25" }, { value: 50, label: "50" }, { value: 100, label: "100" }, { value: 200, label: "200" },
    ] },
    { name: "hours", kind: "number-chips", label: "Lookback", default: 24, presets: "HOURS_PRESETS", suffix: "hr" },
  ],
  get_web_search: [
    QUERY_TICKER_OR_TOPIC({ label: "Search query" }),
    { name: "category", kind: "segmented", label: "Category", default: "news", options: [
      { value: "news", label: "News" }, { value: "general", label: "General" },
    ] },
    { name: "freshness", kind: "segmented", label: "Freshness", default: "day", options: "FRESHNESS_OPTIONS" },
  ],
  get_web_sentiment: [
    QUERY_TICKER_OR_TOPIC(),
    { name: "freshness", kind: "segmented", label: "Freshness", default: "day", options: "FRESHNESS_OPTIONS" },
    { name: "limit", kind: "number-chips", label: "Articles", default: 10, presets: [
      { value: 5, label: "5" }, { value: 10, label: "10" }, { value: 20, label: "20" },
    ] },
  ],
  get_sentiment_trend: [
    QUERY_TICKER_OR_TOPIC(),
    { name: "days", kind: "number-chips", label: "Days of history", default: 7, presets: [
      { value: 3, label: "3d" }, { value: 7, label: "7d" }, { value: 14, label: "14d" }, { value: 30, label: "30d" },
    ] },
    { name: "source", kind: "select", label: "Source", placeholder: "All sources", options: [
      { value: "twitter", label: "Twitter" }, { value: "reddit", label: "Reddit" }, { value: "web", label: "Web" }, { value: "finnhub", label: "Finnhub" },
    ] },
  ],
  get_sentiment_summary: [
    QUERY_TICKER_OR_TOPIC(),
    { name: "hours", kind: "number-chips", label: "Lookback", default: 24, presets: "HOURS_PRESETS", suffix: "hr" },
  ],
};

// Tool name → primary domain icon hint, used by the catalog list. Each domain
// is taken from server-side tool-metadata.ts inferDomain(); kept here for quick
// access without round-tripping.
export const DOMAIN_LABELS = {
  market: "Market",
  fundamentals: "Fundamentals",
  options: "Options",
  portfolio: "Portfolio",
  technical: "Technical",
  sentiment: "Sentiment",
  macro: "Macro",
  interaction: "Interaction",
};

export function schemaForTool(toolName) {
  return TOOL_SCHEMAS[toolName] ?? null;
}
