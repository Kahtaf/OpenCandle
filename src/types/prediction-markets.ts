export interface PredictionMarketQuote {
  source: "polymarket";
  marketId: string;
  title: string;
  outcome: string;
  probability: number;
  volumeUsd?: number;
  liquidityUsd?: number;
  closeDate?: string;
  resolutionCriteria?: string;
  url: string;
  asOf?: string;
}
