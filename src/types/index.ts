export type { StockQuote, OHLCV, CryptoPrice } from "./market.js";
export type { CompanyOverview, EarningsData, FinancialStatement } from "./fundamentals.js";
export type { FredObservation, FredSeries } from "./macro.js";
export { FRED_SERIES } from "./macro.js";
export type { Greeks, OptionContract, OptionsChain } from "./options.js";
export type { Position, PortfolioSummary, RiskMetrics, TechnicalIndicators } from "./portfolio.js";
export type { FearGreedData, RedditSentimentResult } from "./sentiment.js";

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
