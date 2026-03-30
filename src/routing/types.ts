export type WorkflowType =
  | "single_asset_analysis"
  | "portfolio_builder"
  | "options_screener"
  | "compare_assets"
  | "watchlist_or_tracking"
  | "general_finance_qa"
  | "unclassified";

export interface ExtractedEntities {
  symbols: string[];
  budget?: number;
  maxPremium?: number;
  timeHorizon?: string;
  riskProfile?: string;
  direction?: "bullish" | "bearish";
  dteHint?: string;
}

export interface ClassificationResult {
  workflow: WorkflowType;
  confidence: number;
  tier: "rule" | "llm";
  entities: ExtractedEntities;
}

export interface PortfolioSlots {
  budget: number;
  riskProfile: string;
  timeHorizon: string;
  assetScope: string;
  positionCount: number;
  maxSinglePositionPct: number;
  excludeSectors?: string[];
  incomeVsGrowth?: string;
  accountType?: string;
}

export interface OptionsScreenerSlots {
  symbol: string;
  direction: "bullish" | "bearish";
  dteTarget: string;
  objective: string;
  moneynessPreference: string;
  liquidityMinimum: string;
  budget?: number;
  maxPremium?: number;
  ivPreference?: string;
}

export interface CompareAssetsSlots {
  symbols: string[];
  metrics?: string[];
}

export type SlotSource = "user" | "preference" | "default";

export interface SlotResolution<T> {
  resolved: T;
  sources: { [K in keyof T]?: SlotSource };
  defaultsUsed: string[];
  missingRequired: string[];
}
