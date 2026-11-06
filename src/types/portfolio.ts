export interface Position {
  symbol: string;
  shares: number;
  avgCost: number;
  currency: string;
  addedAt: string;
}

export type PortfolioSummary =
  import("../tools/portfolio/portfolio-view.js").ResolvedPortfolioSummary;

export interface RiskMetrics {
  symbol: string;
  annualizedReturn: number;
  annualizedVolatility: number;
  sharpeRatio: number;
  maxDrawdown: number;
  var95: number; // 95% Value at Risk (daily)
}

export interface FundHolding {
  symbol: string;
  name: string;
  weight: number;
}

export interface FundHoldings {
  symbol: string;
  name?: string;
  provider: string;
  holdings: FundHolding[];
  sectorWeights?: Record<string, number>;
}

export interface SharedFundHolding {
  symbol: string;
  name: string;
  weights: Record<string, number>;
  overlapWeight: number;
}

export interface FundOverlapPair {
  symbols: [string, string];
  overlapWeight: number;
  sharedHoldings: SharedFundHolding[];
}

export interface FundHoldingsOverlap {
  funds: FundHoldings[];
  pairs: FundOverlapPair[];
}

export interface TechnicalIndicators {
  symbol: string;
  period: string;
  sma: number[];
  ema: number[];
  rsi: number[];
  macd: { macd: number; signal: number; histogram: number }[];
  bollingerBands: { upper: number; middle: number; lower: number }[];
}

/** Historical lookback windows accepted by analyze_risk and analyze_correlation. */
export const RISK_LOOKBACK_PERIODS = ["6mo", "1y", "2y", "5y"] as const;
export type RiskLookbackPeriod = (typeof RISK_LOOKBACK_PERIODS)[number];
