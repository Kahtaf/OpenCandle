export type { CompanyOverview, EarningsData, FinancialStatement } from "./fundamentals.js";
export type { FredObservation, FredSeries } from "./macro.js";
export { FRED_SERIES } from "./macro.js";
export type { CryptoPrice, OHLCV, StockQuote } from "./market.js";
export type { Greeks, OptionContract, OptionsChain } from "./options.js";
export type { PortfolioSummary, Position, RiskMetrics, TechnicalIndicators } from "./portfolio.js";
export type { PredictionMarketQuote } from "./prediction-markets.js";
export type {
  FearGreedData,
  RedditSentimentResult,
  WebSearchEnvelope,
  WebSearchResult,
} from "./sentiment.js";

/**
 * Handler for `ask_user` tool invocations in non-UI contexts (e.g. test harness).
 * When provided to `createOpenCandleSession`, the ask-user tool calls this handler
 * instead of `ctx.ui.*` methods.
 */
export type AskUserHandler = (params: {
  question: string;
  questionType: "select" | "text" | "confirm";
  options?: string[];
  placeholder?: string;
  reason?: string;
}) => Promise<{ answer: string | null; cancelled: boolean }>;
