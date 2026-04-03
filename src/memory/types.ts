/** Memory categories for typed, selective retrieval. */
export type MemoryCategory =
  | "investor_profile"
  | "interaction_feedback"
  | "workflow_history"
  | "references";

/** A memory entry with category and freshness metadata. */
export interface MemoryEntry {
  key: string;
  value: string;
  category: MemoryCategory;
  recordedAt: string;
  confidence?: string;
  source?: string;
}

/** Staleness thresholds in milliseconds per category. */
export const STALENESS_THRESHOLDS: Record<MemoryCategory, number> = {
  investor_profile: 90 * 24 * 60 * 60 * 1000,    // 90 days
  interaction_feedback: 14 * 24 * 60 * 60 * 1000, // 14 days
  workflow_history: 7 * 24 * 60 * 60 * 1000,      // 7 days
  references: 30 * 24 * 60 * 60 * 1000,           // 30 days
};

/** Map preference keys to memory categories. */
export const KEY_TO_CATEGORY: Record<string, MemoryCategory> = {
  risk_profile: "investor_profile",
  time_horizon: "investor_profile",
  asset_scope: "investor_profile",
  position_count: "investor_profile",
  max_single_position_pct: "investor_profile",
  account_type: "investor_profile",
  income_vs_growth: "investor_profile",
  dte_target: "investor_profile",
  objective: "investor_profile",
  moneyness_preference: "investor_profile",
  liquidity_minimum: "investor_profile",
};

/** Categories relevant to each workflow type. */
export const WORKFLOW_RELEVANT_CATEGORIES: Record<string, MemoryCategory[]> = {
  portfolio_builder: ["investor_profile", "interaction_feedback", "workflow_history"],
  options_screener: ["investor_profile", "interaction_feedback", "workflow_history"],
  compare_assets: ["investor_profile", "workflow_history"],
  comprehensive_analysis: ["investor_profile", "workflow_history"],
  single_asset_analysis: ["investor_profile"],
  general_finance_qa: ["investor_profile"],
  unclassified: ["investor_profile"],
};

/** Check whether a memory entry is stale. */
export function isStale(entry: MemoryEntry, now: Date = new Date()): boolean {
  const threshold = STALENESS_THRESHOLDS[entry.category];
  const age = now.getTime() - new Date(entry.recordedAt).getTime();
  return age > threshold;
}

/** Keys whose values are market-sensitive and must never be trusted from memory. */
export const NEVER_TRUST_FROM_MEMORY = new Set([
  "stock_price",
  "crypto_price",
  "market_thesis",
  "target_price",
  "entry_price",
  "stop_loss",
]);
