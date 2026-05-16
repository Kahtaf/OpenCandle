import type { EvalCase } from "./types.js";

export interface CompetitiveCaseMetadata {
  genericAgentLimitation: string;
  openCandleAdvantage: string;
  evidenceExpectation: string;
}

export type CompetitiveFinanceEvalCase = EvalCase & {
  competitive: CompetitiveCaseMetadata;
};

export const competitiveFinanceCases: CompetitiveFinanceEvalCase[] = [
  {
    name: "competitive-sentiment-comparison",
    tier: "usually",
    prompt: "Compare AAPL and MSFT sentiment. Use current market and retail/news sentiment evidence, then say which setup looks stronger.",
    assertions: {
      expectedWorkflow: "general_finance_qa",
      requiredTools: ["get_sentiment_summary"],
    },
    competitive: {
      genericAgentLimitation: "Generic agents can describe sentiment frameworks, but cannot inspect current market, news, and retail sentiment signals without tools.",
      openCandleAdvantage: "OpenCandle should route to a compare workflow and gather quote, peer, technical, risk, correlation, and sentiment evidence.",
      evidenceExpectation: "The response should compare both symbols with current sentiment evidence and clearly state source availability or gaps.",
    },
  },
  {
    name: "competitive-sec-filings-thesis",
    tier: "usually",
    prompt: "What recent SEC filings for COIN could change the investment thesis? Focus on filings for the actual Coinbase registrant.",
    assertions: {
      expectedWorkflow: "general_finance_qa",
      requiredTools: ["get_sec_filings"],
    },
    competitive: {
      genericAgentLimitation: "Generic agents can list filing types, but cannot verify the latest EDGAR filing set or the exact registrant.",
      openCandleAdvantage: "OpenCandle should retrieve current SEC filing evidence and avoid wrong-company text-search decoys.",
      evidenceExpectation: "The response should identify Coinbase filing evidence with SEC/EDGAR identifiers or links, not only generic filing guidance.",
    },
  },
  {
    name: "competitive-etf-portfolio-constraints",
    tier: "usually",
    prompt: "Build a $25000 ETF portfolio for a conservative investor over 3 years. Keep it ETF-only and explain the main diversification risks.",
    assertions: {
      expectedWorkflow: "portfolio_builder",
      requiredTools: ["get_stock_quote", "analyze_risk", "analyze_correlation"],
    },
    competitive: {
      genericAgentLimitation: "Generic agents can propose a static allocation, but cannot validate ETF prices, risk, and correlations from current data.",
      openCandleAdvantage: "OpenCandle should preserve budget, risk, time horizon, and ETF-only scope while adding live risk and diversification evidence.",
      evidenceExpectation: "The response should stay ETF-only and include current quote/risk/correlation evidence rather than a generic allocation template.",
    },
  },
  {
    name: "competitive-rate-cut-pricing",
    tier: "usually",
    prompt: "What is the market pricing in for rate cuts, and which stock sectors are most exposed? Separate Fed funds history from market-implied probabilities.",
    assertions: {
      expectedWorkflow: "general_finance_qa",
      requiredTools: ["get_economic_data", "search_web"],
    },
    competitive: {
      genericAgentLimitation: "Generic agents can name rate-sensitive sectors, but cannot verify current futures or FedWatch-style rate-cut probabilities.",
      openCandleAdvantage: "OpenCandle should combine macro data with live search evidence for market-implied rate-cut expectations.",
      evidenceExpectation: "The response should distinguish historical Fed funds data from market-implied probabilities before naming exposed sectors.",
    },
  },
  {
    name: "competitive-options-greeks",
    tier: "usually",
    prompt: "Find an options trade idea for TSLA with defined risk and explain the Greeks using the live chain.",
    assertions: {
      expectedWorkflow: "options_screener",
      requiredTools: ["get_stock_quote", "get_option_chain"],
    },
    competitive: {
      genericAgentLimitation: "Generic agents can explain options Greeks conceptually, but cannot rank current contracts or verify liquidity.",
      openCandleAdvantage: "OpenCandle should use the live option chain and expose Greeks, IV, open interest, spread, and missing fields.",
      evidenceExpectation: "The response should bind the Greeks explanation to actual TSLA contracts instead of only describing definitions.",
    },
  },
  {
    name: "competitive-backtest-metrics",
    tier: "usually",
    prompt: "Backtest a simple moving-average strategy on SPY and tell me if it beats buy-and-hold. Include return, drawdown, trades, and win rate.",
    assertions: {
      expectedWorkflow: "general_finance_qa",
      requiredTools: ["backtest_strategy"],
    },
    competitive: {
      genericAgentLimitation: "Generic agents can describe how to run a backtest, but cannot compute current historical strategy results.",
      openCandleAdvantage: "OpenCandle should run the backtest tool and preserve the full computed result, not only the headline return.",
      evidenceExpectation: "The response should report strategy return, benchmark return, drawdown, trade count, and win rate from tool output.",
    },
  },
];

export function competitiveFinanceCasesForTier(tier: string | undefined): CompetitiveFinanceEvalCase[] {
  return tier === "competitive" ? competitiveFinanceCases : [];
}
