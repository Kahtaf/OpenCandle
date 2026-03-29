export interface Position {
  symbol: string;
  shares: number;
  avgCost: number;
  addedAt: string;
}

export interface PortfolioSummary {
  positions: Array<
    Position & {
      currentPrice: number;
      marketValue: number;
      totalCost: number;
      pnl: number;
      pnlPercent: number;
    }
  >;
  totalValue: number;
  totalCost: number;
  totalPnl: number;
  totalPnlPercent: number;
}

export interface RiskMetrics {
  symbol: string;
  annualizedReturn: number;
  annualizedVolatility: number;
  sharpeRatio: number;
  maxDrawdown: number;
  var95: number; // 95% Value at Risk (daily)
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
