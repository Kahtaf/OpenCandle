export interface Position {
  symbol: string;
  shares: number;
  avgCost: number;
  currency: string;
  addedAt: string;
}

export interface PortfolioSummary {
  positions: Array<
    Position & {
      currentPrice: number | null;
      marketValue: number | null;
      totalCost: number;
      pnl: number | null;
      pnlPercent: number | null;
      includedInTotals: boolean;
      quoteStatus?: "ok" | "unavailable";
      exclusionReason?: string;
    }
  >;
  baseCurrency: string;
  totalValue: number;
  totalCost: number;
  totalPnl: number;
  totalPnlPercent: number;
  excludedFromTotals: Array<{
    symbol: string;
    currency: string;
    reason: string;
  }>;
}

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
