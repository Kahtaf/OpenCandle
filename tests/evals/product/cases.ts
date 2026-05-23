import type { ProductEvalCase, ProductEvalDimension, ScenarioTemplate } from "./types.js";

const directAnswer: ProductEvalDimension = {
  id: "direct_answer",
  description: "Answers the user's actual decision or request directly.",
  requiredPatterns: [
    /\b(yes|no|use|compare|reasonable|valid|recommend|rank|screen|build|focus|buy|sell|hold|avoid|prefer|choose|overweight|underweight|current read|our read|most pertinent|most important|top risks?|bottom line)\b/i,
  ],
  mandatory: true,
};

const evidenceUse: ProductEvalDimension = {
  id: "evidence_use",
  description: "Uses concrete evidence rather than generic market commentary.",
  requiredPatterns: [/\b(price|valuation|risk|volatility|technical|fundamental|sentiment|yield|premium|delta|earnings)\b/i],
};

const missingDataHonesty: ProductEvalDimension = {
  id: "missing_data_honesty",
  description: "Marks unavailable or missing evidence instead of hiding gaps.",
  requiredPatterns: [/\b(unavailable|missing|not available|data gap|cannot verify|no live|not enough|unable to fetch)\b/i],
};

const riskFraming: ProductEvalDimension = {
  id: "risk_framing",
  description: "Names downside, uncertainty, invalidation, or tradeoffs.",
  requiredPatterns: [/\b(risk|downside|uncertain|invalidation|caveat|trade[- ]?off|drawdown|loss)\b/i],
  mandatory: true,
};

const horizonFit: ProductEvalDimension = {
  id: "horizon_fit",
  description: "Adapts evidence and conclusion to the stated time horizon.",
  requiredPatterns: [
    /\b(6[- ]?month|six[- ]?month|6mo|short[- ]?term|long[- ]?term|1[- ]?year|12[- ]?month|horizon)\b/i,
    /\b(catalyst|earnings|guidance|estimate|sentiment|forward[- ]?looking|duration|DTE|time decay)\b/i,
  ],
  mandatory: true,
};

const toolBacked: ProductEvalDimension = {
  id: "tool_backed_evidence",
  description: "Uses the tool evidence expected for this prompt family.",
  requiredToolNames: ["get_stock_quote"],
};

export const PRODUCT_SCENARIO_TEMPLATES: ScenarioTemplate[] = [
  {
    id: "compare_assets_with_horizon",
    family: "compare_assets",
    description: "Compares two or more assets while adapting evidence to a stated horizon.",
    dimensions: [directAnswer, horizonFit, toolBacked, evidenceUse, missingDataHonesty, riskFraming],
  },
  {
    id: "single_asset_recommendation_with_risk",
    family: "single_asset",
    description: "Analyzes a single asset and gives a useful stance with risk framing.",
    dimensions: [directAnswer, toolBacked, evidenceUse, riskFraming],
  },
  {
    id: "portfolio_goal_with_constraints",
    family: "portfolio",
    description: "Builds a portfolio that respects budget, risk, horizon, and allocation constraints.",
    dimensions: [directAnswer, horizonFit, evidenceUse, riskFraming],
  },
  {
    id: "options_screen_with_dte_objective",
    family: "options",
    description: "Screens options with DTE, moneyness, liquidity, and risk tradeoffs.",
    dimensions: [directAnswer, horizonFit, evidenceUse, riskFraming],
  },
  {
    id: "sentiment_request_with_source_gaps",
    family: "sentiment",
    description: "Summarizes sentiment while disclosing source coverage and gaps.",
    dimensions: [directAnswer, evidenceUse, missingDataHonesty, riskFraming],
  },
  {
    id: "macro_market_context",
    family: "macro",
    description: "Explains macro/market context without overclaiming unsupported precision.",
    dimensions: [directAnswer, evidenceUse, missingDataHonesty, riskFraming],
  },
  {
    id: "education_without_fake_current_data",
    family: "education",
    description: "Answers educational finance questions clearly without pretending to have current data.",
    dimensions: [directAnswer, evidenceUse, riskFraming],
  },
];

export const PRODUCT_EVAL_CASES: ProductEvalCase[] = [
  makeCase("compare-assets-aapl-msft-6mo", "compare_assets_with_horizon", {
    prompt: "Should I compare AAPL and MSFT for a 6 month investment horizon, and what evidence should matter most?",
    assertions: {
      expectedWorkflow: "compare_assets",
      requiredTools: ["get_stock_quote", "compare_companies", "get_technical_indicators", "analyze_risk"],
    },
  }),
  makeCase("compare-assets-spy-qqq-12mo", "compare_assets_with_horizon", {
    prompt: "Compare SPY and QQQ for a 12 month allocation decision.",
    assertions: {
      expectedWorkflow: "compare_assets",
      requiredTools: ["get_stock_quote", "get_technical_indicators", "analyze_risk"],
    },
  }),
  makeCase("compare-assets-btc-gld-macro-hedge", "compare_assets_with_horizon", {
    prompt: "For the next 6 months, should I use BTC or GLD as a macro hedge?",
    assertions: {
      expectedWorkflow: "compare_assets",
      requiredTools: ["get_stock_quote", "analyze_risk"],
    },
  }),
  makeCase("single-asset-nvda-recommendation", "single_asset_recommendation_with_risk", {
    prompt: "Should I buy NVDA right now? Give me a clear recommendation and risks.",
    assertions: { requiredTools: ["get_stock_quote"] },
  }),
  makeCase("single-asset-tsla-bull-bear", "single_asset_recommendation_with_risk", {
    prompt: "Give me the bull and bear case for TSLA and what would change your mind.",
    assertions: { requiredTools: ["get_stock_quote"] },
  }),
  makeCase("portfolio-balanced-50k", "portfolio_goal_with_constraints", {
    prompt: "Build me a balanced $50k portfolio for a 3 year horizon.",
    assertions: { expectedWorkflow: "portfolio_builder", requiredTools: ["get_stock_quote"] },
  }),
  makeCase("portfolio-income-conservative", "portfolio_goal_with_constraints", {
    prompt: "Create a conservative income portfolio with $100k for the next 5 years.",
    assertions: { expectedWorkflow: "portfolio_builder", requiredTools: ["get_stock_quote"] },
  }),
  makeCase("options-aapl-covered-call", "options_screen_with_dte_objective", {
    prompt: "Find covered call candidates for AAPL around 30 days out.",
    assertions: { expectedWorkflow: "options_screener", requiredTools: ["get_option_chain"] },
  }),
  makeCase("options-msft-bullish-calls", "options_screen_with_dte_objective", {
    prompt: "Screen MSFT bullish call options with good liquidity for the next month.",
    assertions: { expectedWorkflow: "options_screener", requiredTools: ["get_option_chain"] },
  }),
  makeCase("sentiment-meta-source-gaps", "sentiment_request_with_source_gaps", {
    prompt: "What is Reddit and news sentiment saying about META?",
    assertions: { requiredTools: ["get_sentiment_summary"] },
  }),
  makeCase("sentiment-market-ai-stocks", "sentiment_request_with_source_gaps", {
    prompt: "Summarize sentiment around AI stocks and tell me which sources are missing.",
    assertions: { requiredTools: ["get_sentiment_summary"] },
  }),
  makeCase("macro-rates-growth-stocks", "macro_market_context", {
    prompt: "How should falling rates affect growth stocks over the next year?",
    assertions: {},
  }),
  makeCase("macro-inflation-portfolio-risk", "macro_market_context", {
    prompt: "What macro risks matter most for a balanced portfolio right now?",
    assertions: { expectedWorkflow: "general_finance_qa" },
  }),
  makeCase("education-pe-ratio", "education_without_fake_current_data", {
    prompt: "Explain how to use P/E ratios without over relying on them.",
    assertions: {},
  }),
  makeCase("education-options-greeks", "education_without_fake_current_data", {
    prompt: "Explain delta and theta for a beginner considering options.",
    assertions: {},
  }),
];

function makeCase(
  id: string,
  templateId: string,
  overrides: Pick<ProductEvalCase, "prompt"> & Partial<Omit<ProductEvalCase, "id" | "templateId" | "family" | "dimensions" | "prompt">>,
): ProductEvalCase {
  const template = PRODUCT_SCENARIO_TEMPLATES.find((candidate) => candidate.id === templateId);
  if (!template) throw new Error(`Unknown product eval template: ${templateId}`);
  return {
    id,
    templateId,
    family: template.family,
    dimensions: template.dimensions,
    ...overrides,
  };
}
