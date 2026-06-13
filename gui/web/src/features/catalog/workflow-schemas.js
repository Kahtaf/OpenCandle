// Per-workflow input descriptors. The catalog renders these as a builder form
// and produces a chat prompt that the runtime's slot resolver and intent
// classifier can pick up. The slot fields here mirror the typed slot shapes in
// src/routing/types.ts (PortfolioSlots, OptionsScreenerSlots, CompareAssetsSlots).

const WORKFLOW_SCHEMAS = {
  // Single-asset multi-analyst breakdown. Slot is just the symbol; the routing
  // layer fills in defaults for analyst depth from session preferences.
  comprehensive_analysis: {
    headline: "Comprehensive analysis",
    description:
      "Run market, fundamentals, technical, sentiment, and macro analysts on one ticker, then synthesize.",
    fields: [
      { name: "symbol", kind: "symbol", label: "Symbol", required: true, default: "NVDA" },
      {
        name: "depth",
        kind: "segmented",
        label: "Depth",
        default: "standard",
        options: [
          { value: "fast", label: "Fast" },
          { value: "standard", label: "Standard" },
          { value: "deep", label: "Deep" },
        ],
        helper: "Fast: market + fundamentals only. Deep: includes options + macro.",
      },
    ],
    buildPrompt: (values) => {
      const depth = values.depth && values.depth !== "standard" ? ` (${values.depth} depth)` : "";
      return `/analyze ${values.symbol}${depth}`;
    },
  },

  // Mirrors PortfolioSlots — budget, risk profile, time horizon, asset scope,
  // position count. Excluded sectors / income-vs-growth / account type are
  // optional escape hatches in advanced disclosure.
  portfolio_builder: {
    headline: "Portfolio builder",
    description:
      "Build a draft portfolio from goals and constraints. The agent will fetch candidates, check correlation, and present an allocation table.",
    fields: [
      {
        name: "objective",
        kind: "freetext",
        label: "Objective",
        required: true,
        placeholder: "Long-term growth with US tech exposure",
        maxLength: 200,
        helper: "One or two sentences describing what the portfolio is for.",
      },
      {
        name: "budget",
        kind: "money",
        label: "Budget",
        default: 100000,
        helper: "Total amount to allocate.",
      },
      {
        name: "riskProfile",
        kind: "segmented",
        label: "Risk profile",
        default: "balanced",
        options: [
          { value: "conservative", label: "Conservative" },
          { value: "balanced", label: "Balanced" },
          { value: "aggressive", label: "Aggressive" },
        ],
      },
      {
        name: "timeHorizon",
        kind: "segmented",
        label: "Time horizon",
        default: "5y",
        options: [
          { value: "1y", label: "1Y" },
          { value: "3y", label: "3Y" },
          { value: "5y", label: "5Y" },
          { value: "10y", label: "10Y+" },
        ],
      },
      {
        name: "assetScope",
        kind: "segmented",
        label: "Asset scope",
        default: "stocks",
        options: [
          { value: "stocks", label: "Stocks" },
          { value: "stocks_etfs", label: "Stocks + ETFs" },
          { value: "stocks_crypto", label: "Stocks + Crypto" },
        ],
      },
      {
        name: "positionCount",
        kind: "number-chips",
        label: "Positions",
        default: 8,
        presets: [
          { value: 5, label: "5" },
          { value: 8, label: "8" },
          { value: 12, label: "12" },
          { value: 20, label: "20" },
        ],
      },
      {
        name: "maxSinglePositionPct",
        kind: "percent",
        label: "Max single position",
        default: 0.15,
        helper: "Concentration cap, e.g. 15%.",
      },
      {
        name: "excludeSectors",
        kind: "multi-chips",
        label: "Exclude sectors",
        advanced: true,
        options: [
          { value: "energy", label: "Energy" },
          { value: "financials", label: "Financials" },
          { value: "consumer_discretionary", label: "Consumer Discr." },
          { value: "healthcare", label: "Healthcare" },
          { value: "tech", label: "Technology" },
          { value: "real_estate", label: "Real Estate" },
          { value: "utilities", label: "Utilities" },
        ],
      },
      {
        name: "incomeVsGrowth",
        kind: "segmented",
        label: "Tilt",
        advanced: true,
        options: [
          { value: "income", label: "Income" },
          { value: "balanced", label: "Balanced" },
          { value: "growth", label: "Growth" },
        ],
      },
    ],
    buildPrompt: (v) => {
      const constraints = [
        `${formatMoney(v.budget)} budget`,
        v.riskProfile && `${v.riskProfile} risk`,
        v.timeHorizon && `${v.timeHorizon} horizon`,
        v.assetScope && describeScope(v.assetScope),
        v.positionCount && `${v.positionCount} positions`,
        v.maxSinglePositionPct != null &&
          `max ${(v.maxSinglePositionPct * 100).toFixed(0)}% per position`,
        v.incomeVsGrowth && `${v.incomeVsGrowth} tilt`,
        v.excludeSectors?.length && `exclude ${v.excludeSectors.join(", ")}`,
      ]
        .filter(Boolean)
        .join(", ");
      const objective = String(v.objective || "").trim();
      return `Build me a portfolio for ${objective}. Constraints: ${constraints}.`;
    },
  },

  // OptionsScreenerSlots: symbol, direction, dte, objective, moneyness,
  // liquidity, optional budget/maxPremium/ivPreference.
  options_screener: {
    headline: "Options screener",
    description:
      "Pick contracts from a single ticker's chain that match your direction, DTE, and liquidity preferences.",
    fields: [
      { name: "symbol", kind: "symbol", label: "Underlying", required: true, default: "NVDA" },
      {
        name: "direction",
        kind: "segmented",
        label: "Direction",
        required: true,
        default: "bullish",
        options: [
          { value: "bullish", label: "Bullish (calls)" },
          { value: "bearish", label: "Bearish (puts)" },
        ],
      },
      {
        name: "dteTarget",
        kind: "segmented",
        label: "Days to expiry",
        required: true,
        default: "30-45",
        options: [
          { value: "0-7", label: "0–7" },
          { value: "14-30", label: "14–30" },
          { value: "30-45", label: "30–45" },
          { value: "45-90", label: "45–90" },
          { value: "90+", label: "90+" },
        ],
      },
      {
        name: "moneynessPreference",
        kind: "segmented",
        label: "Moneyness",
        required: true,
        default: "atm",
        options: [
          { value: "itm", label: "ITM" },
          { value: "atm", label: "ATM" },
          { value: "otm", label: "OTM" },
        ],
      },
      {
        name: "liquidityMinimum",
        kind: "segmented",
        label: "Liquidity floor",
        required: true,
        default: "tight_spreads",
        options: [
          { value: "any", label: "Any" },
          { value: "tight_spreads", label: "Tight spreads" },
          { value: "high_oi", label: "High open interest" },
        ],
      },
      {
        name: "objective",
        kind: "select",
        label: "Objective",
        required: true,
        default: "directional_leverage",
        options: [
          { value: "directional_leverage", label: "Directional leverage" },
          { value: "hedge", label: "Hedge existing position" },
          { value: "income", label: "Income (sell premium)" },
          { value: "speculative", label: "Speculative (cheap convexity)" },
        ],
      },
      { name: "maxPremium", kind: "money", label: "Max premium per contract", advanced: true },
      {
        name: "ivPreference",
        kind: "segmented",
        label: "IV preference",
        advanced: true,
        options: [
          { value: "any", label: "Any" },
          { value: "low", label: "Low IV" },
          { value: "high", label: "High IV" },
        ],
      },
    ],
    buildPrompt: (v) => {
      const tail = [
        v.dteTarget && `DTE ${v.dteTarget}`,
        v.moneynessPreference && `${v.moneynessPreference.toUpperCase()} strikes`,
        v.liquidityMinimum && describeLiquidity(v.liquidityMinimum),
        v.objective && describeObjective(v.objective),
        v.maxPremium != null && `max premium ${formatMoney(v.maxPremium)}`,
        v.ivPreference && v.ivPreference !== "any" && `${v.ivPreference} IV`,
      ]
        .filter(Boolean)
        .join(", ");
      return `Screen options for ${v.symbol} (${v.direction || "bullish"}). ${tail ? `Filters: ${tail}.` : ""}`.trim();
    },
  },

  // CompareAssetsSlots: symbols (chips) + optional metrics filter.
  compare_assets: {
    headline: "Compare assets",
    description:
      "Side-by-side comparison of two or more tickers across price, technicals, fundamentals, and risk.",
    fields: [
      {
        name: "symbols",
        kind: "symbols",
        label: "Tickers",
        required: true,
        min: 2,
        max: 6,
        default: ["NVDA", "AMD"],
        helper: "2 to 6 symbols.",
      },
      {
        name: "metrics",
        kind: "multi-chips",
        label: "Focus on",
        advanced: true,
        options: [
          { value: "valuation", label: "Valuation" },
          { value: "growth", label: "Growth" },
          { value: "profitability", label: "Profitability" },
          { value: "momentum", label: "Momentum" },
          { value: "risk", label: "Risk" },
        ],
      },
    ],
    buildPrompt: (v) => {
      const list = (v.symbols || []).join(" vs ");
      const focus = v.metrics?.length ? ` Focus on ${v.metrics.join(", ")}.` : "";
      return `Compare ${list} side by side.${focus}`;
    },
  },
};

function describeScope(scope) {
  if (scope === "stocks_etfs") return "stocks and ETFs";
  if (scope === "stocks_crypto") return "stocks and crypto";
  return "stocks only";
}

function describeLiquidity(value) {
  if (value === "tight_spreads") return "tight bid-ask spreads";
  if (value === "high_oi") return "high open interest";
  return "any liquidity";
}

function describeObjective(value) {
  if (value === "directional_leverage") return "directional leverage";
  if (value === "hedge") return "hedge an existing position";
  if (value === "income") return "income via short premium";
  if (value === "speculative") return "speculative cheap convexity";
  return value;
}

function formatMoney(value) {
  if (value == null) return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return `$${n.toLocaleString("en-US")}`;
}

export function schemaForWorkflow(workflowId) {
  return WORKFLOW_SCHEMAS[workflowId] ?? null;
}
