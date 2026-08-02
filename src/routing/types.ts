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
  assetScope?: string;
  positionCount?: number;
  maxSinglePositionPct?: number;
  riskProfile?: string;
  direction?: "bullish" | "bearish";
  dteHint?: string;
  optionStrategy?: "covered_call" | "protective_put";
  heldSymbol?: string;
  catalystSymbols?: string[];
  costBasis?: number;
  shareQuantity?: number;
  compareMetrics?: string[];
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
  optionStrategy?: "covered_call" | "protective_put";
  costBasis?: number;
  shareQuantity?: number;
  catalystSymbols?: string[];
  ivPreference?: string;
}

export interface CompareAssetsSlots {
  symbols: string[];
  timeHorizon?: string;
  metrics?: string[];
  budget?: number;
  assetScope?: string;
}

export type SlotSource = "user" | "preference" | "default" | "prior_context" | "memory";

export interface SlotResolution<T> {
  resolved: T;
  sources: { [K in keyof T]?: SlotSource };
  defaultsUsed: string[];
  missingRequired: string[];
}
